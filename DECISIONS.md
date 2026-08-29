# Legacy Vault — Decisions (Phase A)

Living record of every product decision made before design and code.
Each entry records: the **Question**, the **Options** considered, the
**Decision**, and the **Reason**. Undecided items are marked **OPEN**
with the action that would resolve them. Nothing here is invented on the
user's behalf — OPEN means genuinely unanswered.

Status legend:
- **DECIDED** — settled, safe to build against.
- **PROVISIONAL** — chosen, but conflicts with the spec or depends on an
  OPEN item; must be revisited before it is safe to rely on.
- **OPEN** — not yet decided; resolving action noted.

Cross-references: `PRODUCT_SPEC.md` (spec) and `CLAUDE.md` (invariants).
The governing rule for every entry: **being wrong is worse than being
slow.** A false positive (release while alive) is catastrophic; a false
negative (release late) is cheap.

---

## Area 1 — Jurisdiction & legal

### 1.1 Primary launch jurisdiction — **OPEN**
- **Question:** Which jurisdiction does Legacy Vault operate in first?
  This governs automated-call consent law, data-protection regime, and
  executor/will language.
- **Options:** United States (TCPA + state privacy + RUFADAA) · United
  Kingdom (UK GDPR + PECR) · a single EU member state (GDPR + ePrivacy).
- **Decision:** **OPEN.**
- **Resolving action:** Pick the launch jurisdiction. Blocks 1.3
  (call consent), 5.3 (audit retention horizon), and any compliance
  claim. Until set, all consent/retention choices below are provisional.

### 1.2 The legal layer (will / executor authority) — **DECIDED**
- **Question:** Should the product require/generate the will + executor
  language, or treat it as the user's responsibility?
- **Options:** Ship template + prompt user · Require proof before
  arming the death path · Advise only, store nothing legal.
- **Decision:** **User's own responsibility — the product only advises.**
  Show guidance; do not store or generate legal instruments.
- **Reason:** Keeps V1 out of the business of drafting legal documents.
- **⚠ Flag:** Spec §8 says the legal layer "must ship in V1" because a
  silent trustee or locked registrar can strand everything regardless of
  code quality. "Advise only" is the lightest option and leaves that risk
  with the user. Recommend the advisory copy be prominent and repeated at
  onboarding and in the quarterly drill. Revisit if support sees stranded
  estates.

### 1.3 Automated-call consent at enrollment — **PROVISIONAL**
- **Question:** How strict a consent posture for automated outreach calls
  to trustees?
- **Options:** Explicit written opt-in (logged + timestamped) · Double
  opt-in via separate channel · Implied consent from being added.
- **Decision (provisional):** **Implied consent from being added.**
- **⚠ Conflict:** This contradicts **spec §4**, which states every
  trustee "must opt in when added… a legal requirement in most
  jurisdictions for automated calls, not a nicety." With jurisdiction
  (1.1) OPEN, this cannot be validated as compliant anywhere.
- **Status:** Held as PROVISIONAL, not DECIDED. Per the conservative
  rule, do not build implied-consent-only calling until jurisdiction is
  chosen and counsel confirms. Enrollment should still capture a
  consent timestamp field so upgrading to explicit opt-in is a data
  change, not a schema change.
- **Resolving action:** Resolve 1.1, then legal review.

---

## Area 2 — Pricing & dormancy

### 2.1 Subscription lapses while user is alive — **DECIDED**
- **Question:** If billing lapses while the user is alive but inactive,
  what does the death path do?
- **Options:** Freeze death path + retain content · Grace period then
  read-only · Treat lapse as a liveness question.
- **Decision:** **Flag red in the admin panel; handled manually for now.**
  A lapsed-while-alive account is surfaced to an operator rather than
  auto-progressing or auto-deleting.
- **Reason:** Billing failure is never treated as evidence of death, and
  no automated rule fires. Manual handling is acceptable at pilot scale
  (see 7.2).
- **Note:** "Manual for now" is explicitly a pilot-scale decision. Must be
  revisited before scaling (7.2) — see also OPEN item 2.3.

### 2.2 Post-death funding / handling — **DECIDED**
- **Question:** After death, nobody pays the subscription. How is the
  post-death period handled?
- **Options:** Prepaid delivery+retention bundled · One-time settlement at
  release · Best-effort, delete after a fixed window.
- **Decision:** **Best-effort delivery, then delete after a fixed window.**
  The fixed window is pinned in **5.1 (30 days after final release).**
- **Reason:** Simple; does not depend on live billing or estate
  settlement to complete a release. Ties directly to retention (Area 5).

### 2.3 Automated dormancy/lapse policy at scale — **OPEN**
- **Question:** What automated (non-manual) lapse handling replaces the
  manual admin flag once volume exceeds a founder's manual capacity?
- **Decision:** **OPEN.**
- **Resolving action:** Define a billing-lifecycle policy (grace length,
  nudge cadence, read-only downgrade) before exceeding pilot scale (7.2).

---

## Area 3 — Vendor risk

Model/vendor split is fixed by CLAUDE.md: **Gemini** for speech (STT/TTS
on calls), **DeepSeek v4** for all other text/reasoning. Overarching hard
rule: **no model output ever advances the state machine.**

### 3.1 Gemini (speech) unavailable — **DECIDED**
- **Question:** If Gemini is deprecated, region-blocked, or price-spiked,
  what happens to in-flight verification?
- **Options:** Block entry to VERIFYING (health-check gate) · Fall back to
  a second speech vendor · Degrade to email-only outreach.
- **Decision:** **Degrade to email-only outreach, and flag in the admin
  panel.**
- **Reason:** Losing the call channel *weakens* verification (fewer
  channels to reach quorum), which pushes toward STALLED, not toward
  release — the safe direction. Invariant 6 is unaffected (calls never
  carried content anyway). Admin flag ensures a human notices the
  degraded mode.
- **Note:** Weekly health checks (spec §6) are what detect the outage and
  drive the degradation + flag.

### 3.2 DeepSeek v4 (text) unavailable — **DECIDED**
- **Question:** If DeepSeek is unavailable, what happens? (Models only
  draft copy; they never decide state.)
- **Options:** Continue with static-template copy · Fall back to a second
  text vendor · Block outreach until restored.
- **Decision:** **Block outreach and flag in the admin panel.**
- **Reason:** Blocking is the conservative direction — it only delays
  (false negative, cheap), never releases. Chosen over static-template
  fallback deliberately: the user prefers a human to look before outreach
  continues on a degraded stack.
- **Note:** This is an operational gate, not the model gating state — the
  machine itself is untouched; outreach effects are simply held. Consistent
  with CLAUDE.md.

### 3.3 Backup vendors in V1 — **DECIDED**
- **Question:** Pre-integrate backup vendors, or single-vendor with the
  adapter boundary as the escape hatch?
- **Options:** Single vendor each (adapter boundary only) · Pre-integrate
  backups · Backup for speech only.
- **Decision:** **Single vendor each; the `src/adapters/models/` boundary
  is the escape hatch.** Swapping a vendor stays a one-file change.
- **Reason:** Matches CLAUDE.md; lowest V1 cost. The degrade/block
  behaviors in 3.1/3.2 cover outages without a second vendor.

---

## Area 4 — Identity

### 4.1 Trustee authentication on the confirmation link — **DECIDED**
- **Question:** How does a trustee prove identity when confirming a death?
  (Spec §4 requires an authenticated identity trail.)
- **Options:** Unique link + OTP on separate channel · Link + OTP +
  explicit re-consent attestation · Magic link only.
- **Decision:** **Unique signed link + one-time code on a separate
  channel + an explicit on-screen re-consent attestation** in which the
  trustee re-affirms the weight of the decision before confirming.
- **Reason:** Strongest identity trail with two-channel possession proof;
  the attestation creates a deliberate, logged moment of consent.
- **Process note (⚠ invariant 6):** The user intends the outreach call to
  *explain the process* first. This is allowed **only** insofar as the
  call describes what will happen next. The call must **never speak the
  link, the one-time code, or any content** — that remains invariant 6 and
  is mechanically enforced (see Step 4 in the prompt pack). "Explain the
  process" ≠ "read the code aloud."

### 4.2 Trustee contact rot at verification time — **DECIDED**
- **Question:** When a trustee's enrolled phone/email is invalid at
  verification, what happens to their potential confirmation?
- **Options:** Cannot confirm; counts toward exhausted, never quorum ·
  Allow admin-assisted re-verification of contact.
- **Decision:** **Allow admin-assisted re-verification of contact** before
  the trustee can contribute a confirmation.
- **Reason:** Recovers reachability without silently dropping a valid
  trustee. **Must be logged immutably (invariant 7)** and performed by the
  admin role (7.3). Quarterly drill (spec §6) remains the primary
  mitigation for rot before it matters.
- **Note:** Re-verification updates contact details only; it never
  substitutes for the trustee's own authenticated confirmation (4.1).

---

## Area 5 — Data retention

### 5.1 Post-release retention window — **DECIDED**
- **Question:** How long is content retained after release completes?
- **Options:** 90 days · 30 days · 1 year, then purge.
- **Decision:** **30 days after final release, then permanent purge.**
  This is the "fixed window" referenced in 2.2.
- **Reason:** Minimizes standing sensitive-content-at-rest while giving
  recipients a clear retrieval window. The 72h one-time access code is
  re-issuable within this window (spec §2 PRIVATE_RELEASE).
- **Note:** "Final release" = last release event on the account
  (PUBLIC_RELEASE if enabled, else PRIVATE_RELEASE).

### 5.2 User self-deletion while alive — **DECIDED**
- **Question:** Can a living user delete their content/account, and how
  completely?
- **Options:** Immediate hard delete anytime · Soft delete + grace period
  then hard delete.
- **Decision:** **Soft delete + grace period, then hard delete.** A
  recoverable window precedes permanent erasure.
- **Reason:** Guards against accidental or coerced deletion while still
  honoring the user's control. Content is erased on hard delete; the
  immutable audit log (5.3, invariant 7) retains **metadata only**, never
  content.
- **OPEN sub-item:** Grace-period length **N** is not yet set — resolving
  action: pick N alongside the account-lifecycle policy.

### 5.3 Audit log retention & content exclusion — **DECIDED (horizon
provisional on 1.1)**
- **Question:** How long is the immutable audit log kept, and does it ever
  hold content?
- **Options:** Metadata only, 7 years · Metadata only, 2 years.
- **Decision:** **Metadata only, retained 2 years.** The log stores
  timestamps, channels, outcomes, and state transitions — **never**
  content, URLs, or access codes. Content purges (5.1/5.2) never touch the
  audit trail.
- **Reason:** Satisfies invariant 7 (immutable outreach + transition log)
  while limiting standing data.
- **⚠ Note:** The 2-year horizon may be shorter than a chosen
  jurisdiction's dispute/legal-defense needs. Revisit once 1.1 is set.

---

## Area 6 — Support

### 6.1 Support & the 2am safety channel — **DECIDED**
- **Question:** Who does a confused trustee — or a grieving-but-alive
  user — reach at 2am?
- **Options:** 24/7 human on-call for death-path events · Business-hours
  support + always-on self-serve cancel · Email/ticket best-effort.
- **Decision:** **Business-hours human support, plus a 24/7 self-serve
  cancel** that requires no login (signed single-purpose token), so an
  alive user can always stop everything without waiting for a human.
- **Reason:** Leans on the product's own most important safety feature —
  the one-tap cancel — as the always-available path, rather than paying
  for 24/7 staffing. The cancel path's uptime is the project's highest
  SLO (spec §2 CANCELLED; prompt-pack Step 5).
- **Dependency:** This makes the cancel endpoint's reliability a support
  requirement, not just an engineering one.

---

## Area 7 — Scale & cost

### 7.1 V1 scale target — **DECIDED**
- **Question:** What scale should V1 be designed for?
- **Options:** Small pilot <1k users · Early growth 1k–10k.
- **Decision:** **Small pilot: <1,000 users.**
- **Reason:** A controlled early cohort makes the manual-handling
  decisions (2.1 lapse, 3.1/3.2 vendor flags, 4.2 re-verification, admin
  freeze) feasible with a small team.

### 7.2 Manual-handling assumption — **DECIDED (with revisit trigger)**
- **Decision:** All "handled manually / admin-flagged" decisions above
  assume pilot volume. **Revisit trigger:** before crossing ~1k active
  users or any month where manual queues exceed one operator's capacity,
  revisit 2.3 (automated lapse policy) and 7.3 (staffing).

### 7.3 Admin / human-review staffing — **DECIDED**
- **Question:** Who staffs the audited manual steps (admin red-flag,
  STALLED review, contact re-verification, admin freeze)?
- **Options:** Founder/small team does all admin review · Dedicated
  trust-and-safety role.
- **Decision:** **Founder / small team handles all admin review in V1.**
- **Reason:** Fits pilot scale. **Single-point-of-failure risk noted:** a
  sole operator being unavailable must never cause a release — STALLED and
  the admin gates fail *safe* (toward delay), consistent with invariant 5.

---

## Area 8 — Security architecture (surfaced, not originally listed)

### 8.1 Content encryption key custody — **DECIDED**
- **Question:** Who holds the keys that decrypt content for release?
- **Options:** Company-held (server-side envelope encryption) · Company
  now + Shamir across trustees later · User-held key escrowed for release.
- **Decision:** **Company-held keys (server-side envelope encryption).**
- **Reason:** Simplest and makes release reliable; matches spec §8, which
  explicitly **defers** Shamir key-splitting as the right answer for
  company-independence but wrong complexity for V1.
- **⚠ Residual risk (documented, accepted for V1):** Company insiders or a
  server compromise could in principle access content. Mitigations:
  encryption at rest, access logging (spec §7), admin-revocable access,
  and the deferred-but-noted Shamir path for a later version. Design the
  envelope so trustee key-splitting can be layered in later without a data
  migration.

### 8.2 Living-user account recovery — **DECIDED**
- **Question:** If the living user loses phone + password, how do they
  recover without opening an account-hijack path that could force a
  release?
- **Options:** Manual, identity-verified admin recovery only · Backup
  channels + admin fallback.
- **Decision:** **Access is recoverable only by contacting the admin, who
  verifies identity manually under audit.** No automated self-serve reset.
- **Reason:** No automated reset means no automated path an attacker could
  abuse to seize an account and trigger a false release. Slow by design,
  which is acceptable and correct here. Recovery actions are logged
  (invariant 7). Staffed per 7.3.

---

## Area 9 — Content authoring interface (captured from user)

### 9.1 How users create/store content — **CAPTURED, needs detail**
- **What the user described:** A notepad-like authoring interface where
  users can write directly, plus the ability to write/save content as
  PDFs. Content is created in-product and saved.
- **Status:** Captured as product intent. **Detail OPEN:** supported
  formats beyond notes/PDF (photos are named in the spec intro), size
  limits, and edit-after-save behavior are not yet specified.
- **Resolving action:** Define the content model during Phase B (UX) and
  Phase C (schema — `Payload` entity). All stored content remains
  encrypted at rest (spec §7, decision 8.1) regardless of format.

---

## Area 10 — Open items to resolve before / during later phases

- **10.1 Trustee-who-is-also-a-recipient — OPEN.** The Phase A answer
  described the authoring interface (9.1) rather than resolving this. It
  remains a **known adversarial vector** (prompt-pack Step 7): a person
  who both confirms death and receives content has a self-dealing
  incentive. **Resolving action:** decide between (a) prohibiting the same
  identity as both trustee and recipient at enrollment, or (b) allowing it
  but excluding their confirmation from any quorum that would release to
  themselves. Must be resolved before Step 2 (state machine) hard-codes
  quorum eligibility.
- **10.2 Minors / legal capacity — OPEN.** Whether trustees, recipients,
  or account holders may be minors, and any capacity requirements, was not
  covered. **Resolving action:** decide alongside jurisdiction (1.1) and
  counsel.
- **10.3 Grace-period length N for soft delete (5.2) — OPEN.**
- **10.4 Recipient-fallback silence window "N days" (spec §7) — OPEN.**
  The number of days of recipient silence before automatic fallback to the
  next recipient is not yet chosen. **Resolving action:** set during Phase
  C (API/schema) — never introduce this timer without an explicit
  decision (CLAUDE.md working-style rule).

---

## Summary of what is safe to build against now

- Company-held envelope encryption (8.1); manual, audited account recovery
  (8.2).
- Trustee confirmation via signed link + separate-channel OTP + on-screen
  re-consent (4.1), with the call never speaking link/code/content
  (invariant 6).
- Admin-assisted contact re-verification, logged (4.2).
- 30-day post-release retention then purge (5.1); soft-delete-then-hard
  for living users (5.2, N TBD); metadata-only audit log, 2 years (5.3).
- Business-hours support + always-on tokenized self-serve cancel (6.1).
- Pilot scale <1k, founder-run admin review, everything fails safe toward
  delay (7.x).
- Single vendor each behind the model adapters; Gemini-down → email-only +
  flag; DeepSeek-down → hold outreach + flag (3.x).

## Must be resolved before relying on them

- **Jurisdiction (1.1)** — gates consent (1.3) and audit horizon (5.3).
- **Trustee call consent (1.3)** — PROVISIONAL, conflicts with spec §4.
- **Trustee=recipient (10.1)** — before quorum logic is built.
- **The two unset timers (10.3 soft-delete N, 10.4 recipient-fallback N)**
  — never introduce a timer the spec/decisions don't specify.
