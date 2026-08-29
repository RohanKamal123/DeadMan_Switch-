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

## Area 0 — Major V1 pivot: no AI, manual operations

**This decision reshapes the whole of V1 and supersedes parts of the
original spec. Read it first — several later entries are annotated as
superseded by it.**

- **Decision:** V1 ships **no AI voice, no automated calling agents, and
  no automated trustee-outreach state machine.** "We are not an AI
  company; we are a product-delivery process." The software's job in V1 is
  to **connect users, track their aliveness, and give the operator team
  the tools to verify and deliver manually.**
- **What the software still does automatically (the built infrastructure):**
  - User accounts, encrypted content storage, contact/recipient lists.
  - The **liveness system**: check-ins, missed-check-in detection, and the
    NUDGE reminders to the *user only* (no third party — invariant 2 holds
    trivially, since nothing automated contacts third parties at all).
  - Flagging accounts to an **operator queue** when a user is unresponsive
    for a long period.
  - The **HOLD cancel window** — a deterministic timer plus an always-on
    one-tap "I'm alive" cancel link (see 0.1). This stays fully automated
    and is the primary safety mechanism.
  - The **release delivery** to recipients (gated page + one-time code)
    once a HOLD elapses.
  - Immutable audit logging of every operator action and state transition
    (invariant 7).
- **What humans (the founder/small team, ≤~100 customers) do manually:**
  - Notice/confirm a long-unresponsive user (operator queue).
  - Any outreach to the user's contacts is done by a person, not an
    automated call. Verify aliveness / death / accident state.
  - Record findings in an operator note field (alive / deceased / accident
    + free text), viewing contacts one at a time on screen.
  - Decide to **start** a HOLD when they believe a user has died.
- **Reason:** Removes the entire automated-calling risk surface, matches
  the team's actual capacity at pilot scale (≤100 customers, 7.1), and
  keeps the company out of the AI-vendor and automated-call-consent
  business for V1. This is *more* conservative, not less — fewer automated
  paths that could be wrong.

### 0.1 HOLD is mandatory even for manual release — **DECIDED (invariant-critical)**
- **Question:** When an operator marks a user deceased, does content
  release immediately, or still pass through the HOLD cancel window?
- **Decision:** **HOLD is mandatory. The operator can only *start* the
  window — never skip it.** Marking deceased begins HOLD; the user is
  pinged on every channel with a one-tap cancel; content releases **only**
  if the full window elapses with no cancel.
- **HOLD length (manual mode):** **30 days** (matches spec §2 lenient
  mode).
- **Reason:** Preserves **invariant 1** (CANCELLED reachable from every
  state) and **invariant 3** (no release before a HOLD window fully
  elapses). Manual verification is fallible; the 30-day window + one-tap
  cancel is what keeps a wrongly-flagged *living* user's mistake
  recoverable. An earlier answer proposed instant operator release with no
  window; that was **rejected at the interview** because it breaks
  invariant 3 and removes the product's core irreversible-safety promise.
- **Non-negotiable:** No operator action, admin role, or "verified"
  status may bypass the HOLD timer. The timer is deterministic code, not
  an operator judgment.

### 0.2 Downstream document impact — **ACTION NEEDED**
- **PRODUCT_SPEC.md** §2 (VERIFYING as automated batched calls), §6
  (automated weekly test *calls*), and the AI-calling assumptions need a
  revision pass to describe manual verification. The **eight states and
  all seven invariants remain valid** — only the *mechanism* of
  VERIFYING changes from "automated outreach" to "operator-driven
  verification," and STALLED becomes "operator could not verify."
- **CLAUDE.md** "Model and vendor split" (Gemini + DeepSeek) is **removed
  for V1** under this pivot (see Area 3). **Done:** the section was
  replaced with a "No AI vendors in V1" statement at the user's explicit
  instruction, keeping the forward-looking rule that no model output may
  ever advance a state transition.

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

### 1.3 Contact/recipient consent at enrollment — **PROVISIONAL (largely relaxed by Area 0)**
- **Question:** How strict a consent posture for outreach to the user's
  contacts?
- **Original decision (provisional):** Implied consent from being added.
- **Impact of Area 0 pivot:** The spec §4 conflict was about **automated**
  calls, which are **removed from V1**. Any V1 outreach to a contact is
  performed by a **human team member**, which is far less regulated than
  an automated/robocall in every jurisdiction considered. So the sharpest
  version of the conflict no longer applies to V1.
- **Status:** Still **PROVISIONAL** but lower-risk. Enrollment should
  still capture a **consent timestamp** field so that (a) a person knows
  they may be contacted by the team, and (b) re-introducing any automated
  calling later is a data change, not a schema change.
- **Resolving action:** Resolve 1.1, then a light legal check on
  human-initiated contact. No longer a V1 blocker.

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

> **SUPERSEDED FOR V1 by Area 0.** The pivot removes AI from V1 entirely.
> The entries below are retained for history and for whenever automated
> outreach/AI is reconsidered post-V1. See 3.4 for the V1 position.

### 3.4 AI vendors in V1 — **DECIDED: none**
- **Decision:** **V1 uses neither Gemini nor DeepSeek.** Speech (Gemini)
  is unneeded because there are no automated calls. Text drafting
  (DeepSeek) is replaced by **static, human-written templates** for the
  user-facing NUDGE reminders and cancel prompts — which is safer anyway,
  since a template can never hallucinate.
- **Reason:** Matches Area 0. Removes both external AI dependencies and
  their failure modes from the V1 risk surface.
- **CLAUDE.md note:** The "Model and vendor split" section is therefore
  **post-V1 guidance**, not a live V1 rule. Flagged in 0.2. The
  `src/adapters/models/` boundary can still be scaffolded empty so the
  hook exists if AI is added later — but no adapter is wired in V1.

---

Model/vendor split *(original, pre-pivot — retained for history):*
CLAUDE.md fixed **Gemini** for speech (STT/TTS on calls), **DeepSeek v4**
for all other text/reasoning. Overarching hard rule: **no model output
ever advances the state machine.**

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

- **10.1 Trustee-who-is-also-a-recipient — RESOLVED (see 11.3).** Decided:
  roles may merge (one person can be both), **but a person's own
  death-confirmation may never count toward a release that delivers to
  themselves.** Moved to 11.3.
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

## Area 11 — Manual verification & release (V1, per Area 0)

### 11.1 Operator verification console — **DECIDED**
- **Question:** How does the team verify aliveness/death manually?
- **Decision:** An **operator console** that, for a flagged user, shows the
  user's contacts **one at a time** on screen and provides a **note field**
  to record outcome per contact and overall — with an explicit **state tag:
  alive / deceased / accident** plus free text.
- **Reason:** Fits founder/small-team manual handling at ≤100 customers.
  Everything the operator does is written to the immutable audit log
  (invariant 7): who viewed what, who recorded which finding, when.
- **Boundary (⚠ invariant 6):** If a team member phones a contact, the
  human may explain the *situation and process* but must **never read out
  any release link, one-time code, or stored content.** Same rule as the
  old automated call — it now binds the human operator.

### 11.2 How many confirmations before an operator can start HOLD — **DECIDED**
- **Question:** The original spec required **3** independent confirmations
  from **different groups** (invariant 4) before advancing. In manual mode,
  what is the minimum the operator must log before starting a HOLD?
- **Decision:** **At least 3 confirmations, each from a different
  relationship group** (family / colleague / friend / other), entered
  manually by the operator in the console (11.1). Group-diversity is
  enforced: **no two of the required confirmations may come from the same
  group** — invariant 4 held exactly, now checked in the console rather
  than by automated outreach.
- **Reason:** Keeps the full strength of invariant 4 through the pivot. A
  single operator error, or one person with several phones, cannot reach
  the threshold; three different-group confirmations plus the 30-day HOLD
  (0.1) are two independent defenses against a false positive.
- **Enforcement:** The start-HOLD action is blocked in code until ≥3
  confirmations from ≥3 distinct groups are recorded. Each recorded
  confirmation is written to the immutable audit log (invariant 7) with its
  contact identity, group, and the operator who entered it. The
  self-dealing exclusion (11.3) applies: a recipient's own confirmation is
  not counted toward a release to themselves.

### 11.3 Merged trustee/recipient roles + self-dealing guard — **DECIDED**
- **Question:** A person may be both a confirmer and a recipient. May their
  own confirmation count toward a release that delivers to themselves?
- **Decision:** **Roles may merge, but a person's own death-confirmation
  may NEVER count toward a release that delivers content to that same
  person.** Their confirmation is excluded from the count for their own
  delivery.
- **Reason:** Removes the self-dealing incentive (the exact vector the
  adversarial review calls out) while allowing the flexibility the user
  wants. Enforced in code at confirmation-counting time.
- **Depends on 11.2:** The exclusion rule plugs into whatever minimum-
  confirmation count 11.2 settles on.

### 11.4 The automated liveness/nudge core is unchanged — **DECIDED**
- **Decision:** ACTIVE → NUDGE (user-only reminders) → operator-queue flag
  → (manual verify) → HOLD → release remains the flow. **All eight states
  and all seven invariants still apply.** NUDGE reminders use static
  templates (3.4). VERIFYING is reinterpreted as operator-driven, not
  automated calling; STALLED = operator could not verify and it still
  never auto-advances toward release (invariant 5).
- **Note for later phases:** Step 2's pure state machine still gets built
  exactly as specified — the pivot changes *who/what fires the events*
  (an operator action instead of an automated outreach result), not the
  transition table or the invariants it enforces.

---

## Summary of what is safe to build against now

**Shape of V1 (Area 0):** No AI, no automated calling. Build the
infrastructure — accounts, encrypted content, contact/recipient lists,
liveness tracking, user-only NUDGE reminders (static templates), an
operator console for manual verification, the deterministic HOLD window +
one-tap cancel, and gated release delivery. Humans verify and decide;
code enforces the timers, the cancel, and the audit log.

- **HOLD is mandatory even in manual release (0.1)** — operator *starts*
  it, 30-day window, one-tap cancel throughout; content releases only if
  the window fully elapses. Invariants 1 & 3 preserved.
- Company-held envelope encryption (8.1); manual, audited account recovery
  (8.2).
- Recipient release via gated page + separate-channel one-time code, 72h
  expiry re-issuable (spec §2); no operator ever speaks a link/code/content
  (invariant 6, now binding the human — 11.1).
- Merged trustee/recipient roles with a self-dealing guard (11.3).
- 30-day post-release retention then purge (5.1); soft-delete-then-hard
  for living users (5.2, N TBD); metadata-only audit log, 2 years (5.3).
- Business-hours support + always-on tokenized self-serve cancel (6.1).
- Pilot scale ≤100–1,000 users, founder-run operator review, everything
  fails safe toward delay (7.x).
- No AI vendors in V1; NUDGE/cancel copy is static templates (3.4). The
  `src/adapters/models/` hook may be scaffolded empty for later.
- Operator must log **≥3 confirmations from ≥3 different groups** before a
  HOLD can start (11.2); invariant 4 enforced in the console.

## Must be resolved before relying on them

- **Jurisdiction (1.1)** — gates audit horizon (5.3) and light consent
  check (1.3). No longer a hard V1 blocker now that automated calls are
  gone.
- **The two unset timers (10.3 soft-delete N, 10.4 recipient-fallback N)**
  — never introduce a timer the spec/decisions don't specify.
- **Content model detail (9.1), minors/capacity (10.2)** — resolve in
  Phase B/C.

## Recommended doc follow-ups (flagged, not yet done)

- Revise **PRODUCT_SPEC.md** §2/§6 wording from automated calling to
  manual verification (states & invariants unchanged) — see 0.2.
- **CLAUDE.md** "Model and vendor split" — **done:** replaced with "No AI
  vendors in V1" per user instruction (see 0.2 / 3.4).
