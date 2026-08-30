# Legacy Vault — Decisions (Phase A)

Current-state record of the product decisions made before design and code.
Each entry records the **Decision** and the **Reason**; unresolved items
are marked **OPEN** with the action that would resolve them. Nothing here
is invented on the user's behalf.

Status legend:
- **DECIDED** — settled, safe to build against.
- **OPEN** — not yet decided; resolving action noted.

Cross-references: `PRODUCT_SPEC.md` (spec) and `CLAUDE.md` (invariants).
Governing rule: **being wrong is worse than being slow.** A false positive
(release while alive) is catastrophic; a false negative (release late) is
cheap.

---

## 0. Shape of V1 — no AI, manual operations — **DECIDED**

V1 ships **no AI voice, no automated calling, and no model dependency.**
"We are not an AI company; we are a product-delivery process." The software
connects users, tracks their aliveness, and gives a **small operator team
(founder + team, ≤~100–1,000 users)** the tools to verify and deliver
manually.

**The software does automatically:**
- Accounts, encrypted content storage, contact/recipient lists.
- The **liveness system**: check-ins, missed-check-in detection, and NUDGE
  reminders to the *user only* (static templates; no third party contacted
  by automation at all).
- Flagging long-unresponsive accounts to an **operator queue**.
- The **HOLD cancel window** — a deterministic timer plus an always-on
  one-tap "I'm alive" cancel link (0.1). Primary safety mechanism.
- **Release delivery** to recipients (gated page + one-time code) once a
  HOLD elapses.
- Immutable audit logging of every operator action and state transition
  (invariant 7).

**Humans do manually:**
- Investigate a flagged user; contact the user's people by phone/email
  **as a person**, not via automation.
- Record findings in the operator console: a per-contact and overall state
  tag (`alive` / `deceased` / `accident` / `unknown`) plus free text.
- Record death **confirmations** (identity + group) toward quorum (11.2).
- **Start** a HOLD when quorum is met and they believe the user has died.

**Reason:** Removes the entire automated-calling risk surface, fits the
team's real capacity at pilot scale, and keeps V1 out of the AI-vendor and
automated-call-consent business. More conservative, not less.

### 0.1 HOLD is mandatory even for manual release — **DECIDED (invariant-critical)**
- **Decision:** HOLD is mandatory. An operator may only **start** the
  window, never skip or shorten it. Marking a user deceased begins HOLD;
  the user is pinged on every channel with a one-tap cancel; content
  releases **only** if the full window elapses with no cancel.
- **HOLD length:** **30 days** (lenient default). Strict mode
  (death-certificate-required) is 21 days and stays blocked until a
  certificate is uploaded.
- **Reason:** Preserves invariant 1 (CANCELLED from every state) and
  invariant 3 (no release before HOLD fully elapses). Manual verification
  is fallible; the window + one-tap cancel keep a wrongly-flagged *living*
  user's mistake recoverable.
- **Non-negotiable:** No operator action, admin role, or "verified" status
  bypasses the timer. The timer is deterministic code.

---

## 1. Jurisdiction & legal

### 1.1 Primary launch jurisdiction — **DECIDED**
- **Decision:** **Bangladesh.** V1 launches to a Bangladesh pilot.
- **Reason:** Founder/operator base and small pilot scale (7.1) keep the
  product manageable under a single jurisdiction.
- **Legal follow-ups (with local counsel; none a V1 blocker):**
  - Confirm the audit-log 2-year metadata horizon (5.3) against Bangladesh
    record-keeping norms; change it only by explicit decision.
  - Enrollment-consent wording (1.3): human outreach is lightly regulated;
    confirm the stored consent timestamp is locally sufficient.
  - The legal layer (1.2, spec §8) is advisory only — there is no
    RUFADAA-style statute granting executor authority over digital assets
    here; advisory copy must reflect Bangladesh succession practice and
    flag cross-border recipients.
  - Data localization / cross-border transfer: if email/SMS/storage vendors
    sit abroad, check Bangladesh's draft data-protection provisions before
    scaling past pilot (revisit with 7.2).

### 1.2 The legal layer (will / executor authority) — **DECIDED**
- **Decision:** The product only **advises** — shows guidance on naming
  trustees in a will and granting the executor authority over digital
  assets; it does not generate or store legal instruments.
- **Reason / flag:** Spec §8 stresses the legal layer matters because a
  silent trustee or locked registrar can strand everything. Advisory copy
  should be prominent at onboarding and repeated in the quarterly drill.
  Revisit if support sees stranded estates.

### 1.3 Contact consent at enrollment — **DECIDED (light)**
- **Decision:** A contact opts in when added (acknowledging the team may
  contact them), and a **consent timestamp** is stored.
- **Reason:** V1 outreach is human, not automated — far less regulated
  than robocalls in every jurisdiction considered, so the spec §4 concern
  about automated-call consent does not bind V1. Storing the timestamp
  keeps a stricter mode a data change, not a schema change, if automation
  ever returns. Light legal check pending 1.1; not a V1 blocker.

---

## 2. Pricing & dormancy

### 2.1 Subscription lapses while user is alive — **DECIDED**
- **Decision:** Flag the account red in the admin panel; **handle
  manually.** No automated rule fires — billing failure is never treated
  as evidence of death.
- **Note:** A pilot-scale decision; revisit with 2.3 before scaling.

### 2.2 Post-death handling — **DECIDED**
- **Decision:** **Best-effort delivery, then delete after a fixed window**
  = 30 days after final release (see 5.1). Does not depend on live billing
  or estate settlement to complete.

### 2.3 Automated dormancy/lapse policy at scale — **OPEN**
- **Resolving action:** Define an automated billing-lifecycle policy
  (grace length, nudge cadence, read-only downgrade) before exceeding
  pilot scale (7.2).

---

## 3. Vendors & dependencies

### 3.1 AI vendors in V1 — **DECIDED: none**
- **Decision:** V1 uses **neither Gemini nor DeepSeek nor any model.**
  Speech is unneeded (no automated calls); text/copy is **static,
  human-written templates** for NUDGE reminders and cancel prompts — a
  template cannot hallucinate.
- **CLAUDE.md:** The "Model and vendor split" section has been replaced
  with "No AI vendors in V1," keeping the forward-looking rule that no
  model output may ever advance a state transition. The
  `src/adapters/models/` hook may be scaffolded empty for a later version.

### 3.2 Notification dependencies — **DECIDED**
- **Decision:** V1 depends on **email, SMS, and storage** providers only.
  A weekly automated health check pings each, sends a real test email/SMS
  to a company-owned address/number and verifies deliverability, and
  verifies stored payloads decrypt. Failure blocks entry to VERIFYING
  (veto path §5) and alerts the team. No automated test call (no telephony
  dependency).

---

## 4. Identity & confirmation

### 4.1 Death confirmation — **DECIDED**
- **Decision:** Confirmations are **recorded manually by the operator** in
  the console, each with the contact's identity, group, recording
  operator, and timestamp, written to the immutable audit log (invariant
  7). The human call/email only prompts; the logged entry is the identity
  trail.
- **Boundary (invariant 6):** A human operator phoning a contact may
  explain the situation and process but must **never** read out a release
  link, one-time code, or any content.

### 4.2 Recipient release authentication — **DECIDED**
- **Decision:** The recipient authenticates via a **gated page link
  (email) + a one-time code on a separate channel (SMS)**, 72h expiry,
  re-issuable. No content in the email body; access logged and
  admin-revocable.

### 4.3 Contact rot at verification time — **DECIDED**
- **Decision:** Allow **admin-assisted re-verification** of a stale
  contact (logged, invariant 7) before their confirmation can count. The
  quarterly drill (§6) is the primary mitigation. Re-verification updates
  contact details only; it never substitutes for the confirmation itself.

---

## 5. Data retention

### 5.1 Post-release retention — **DECIDED**
- **Decision:** **30 days after final release, then permanent purge.** The
  72h one-time access code is re-issuable within this window. "Final
  release" = the last release event on the account.

### 5.2 User self-deletion while alive — **DECIDED**
- **Decision:** **Soft delete + 7-day grace period, then hard delete.**
  Content is erased on hard delete; the immutable audit log keeps
  **metadata only, never content.**
- **Reason:** 7 days honors a genuine delete request promptly while leaving
  a window to reverse a deletion forced by an attacker who seized the
  account (recovery is manual, 8.2). Recovery within the window is manual
  and logged (invariant 7).

### 5.3 Audit log retention — **DECIDED (horizon depends on 1.1)**
- **Decision:** **Metadata only, retained 2 years.** Stores timestamps,
  channels, outcomes, operator actions, and state transitions — never
  content, URLs, or codes. Content purges never touch the audit trail.
- **Note:** Jurisdiction is Bangladesh (1.1); confirm the 2-year horizon
  against local record-keeping norms with counsel. Change only by explicit
  decision.

---

## 6. Support

### 6.1 Support & the 2am safety channel — **DECIDED**
- **Decision:** **Business-hours human support**, plus a **24/7 self-serve
  cancel** requiring no login (signed single-purpose token), so an alive
  user can always stop everything without waiting for a human.
- **Reason:** Leans on the one-tap cancel — the product's most important
  safety feature — as the always-available path. The cancel endpoint's
  uptime is the project's highest SLO.

---

## 7. Scale & staffing

### 7.1 V1 scale target — **DECIDED**
- **Decision:** **Small pilot, ≤~100–1,000 users.** Makes all the
  manual-handling decisions feasible with a small team.

### 7.2 Manual-handling assumption — **DECIDED (revisit trigger)**
- **Decision:** All manual/admin-flagged decisions assume pilot volume.
  **Revisit** before ~1k active users, or any month manual queues exceed
  one operator's capacity: 2.3 (automated lapse) and 7.3 (staffing).

### 7.3 Operator / admin staffing — **DECIDED**
- **Decision:** **Founder / small team** handles all operator and admin
  review in V1, under audit.
- **Single-point-of-failure guard:** A sole operator being unavailable
  must never cause a release — STALLED and every admin gate fail *safe*,
  toward delay (invariant 5).

---

## 8. Security architecture

### 8.1 Content encryption key custody — **DECIDED**
- **Decision:** **Company-held keys (server-side envelope encryption).**
  Matches spec §8, which defers Shamir key-splitting as right-but-too-
  complex for V1.
- **Residual risk (accepted for V1):** Company insiders or a server
  compromise could in principle access content. Mitigations: encryption at
  rest, access logging (§7), admin-revocable access, and the noted Shamir
  path later. Design the envelope so trustee key-splitting can be added
  without a data migration.

### 8.2 Living-user account recovery — **DECIDED**
- **Decision:** Recoverable **only by contacting the admin, who verifies
  identity manually under audit.** No automated self-serve reset.
- **Reason:** No automated reset = no automated path an attacker could
  abuse to seize an account and force a release. Slow by design, correct
  here. Recovery actions are logged (invariant 7).

---

## 9. Content authoring interface

### 9.1 How users create/store content — **DECIDED (shape); size limits OPEN**
- **Captured:** A notepad-like authoring interface for writing directly,
  plus writing/saving content as PDFs. Photos are named in the spec intro.
- **Phase C `Payload` schema (`src/domain/payload.ts`):** fixes the content
  model *shape* — kinds (`note` / `photo` / `pdf`), the envelope-encryption
  structure (per-item data key wrapped by a company KMS key, shaped so trustee
  key-splitting can be added later without a data migration, 8.1), addressing
  to recipients (UX §1.4), item versioning, and the freeze rule (authoring
  stops once a release is pending). Content is only ever stored as ciphertext;
  there is no plaintext field.
- **Still OPEN — size limits:** the concrete per-kind byte limits are a
  deployment decision (11.5), supplied to the schema as a `ContentPolicy` and
  enforced there, **never invented in the domain** (CLAUDE.md forbids a
  threshold the spec is silent on).

---

## 10. Operator verification & release (V1)

### 10.1 Operator console — **DECIDED**
- **Decision:** For a flagged user, the console shows the user's contacts
  **one at a time**, with a **note field** and a **state tag** (`alive` /
  `deceased` / `accident` / `unknown`) recorded per contact and overall.
  Every view and entry is audit-logged (invariant 7).

### 10.2 Confirmations required before HOLD can start — **DECIDED**
- **Decision:** **At least 3 confirmations, each from a different group**
  (family / colleague / friend / other), entered manually by the operator.
  **Group diversity enforced** — no two of the required three may share a
  group (invariant 4, now checked in the console). The start-HOLD action is
  blocked in code until ≥3 confirmations from ≥3 distinct groups are
  recorded.
- **Reason:** Keeps invariant 4 at full strength through the pivot. A
  single operator error, or one person with several phones, cannot reach
  the threshold; three different-group confirmations plus the 30-day HOLD
  (0.1) are two independent defenses against a false positive.

### 10.3 Merged trustee/recipient roles + self-dealing guard — **DECIDED**
- **Decision:** A person may be both a confirmer and a recipient, **but
  their own confirmation is never counted toward a release that delivers
  content to that same person.** Enforced at confirmation-counting time.

### 10.4 Liveness/nudge core unchanged — **DECIDED**
- **Decision:** ACTIVE → NUDGE (user-only reminders) → operator-queue flag
  → (manual verify) → HOLD → release. All eight states and seven
  invariants apply. NUDGE uses static templates. VERIFYING is
  operator-driven; STALLED = operator could not verify and never
  auto-advances (invariant 5). The Step-2 pure state machine is built
  as specified — the pivot changes what *fires* the events (an operator
  action), not the transition table or the invariants.

---

## 11. Still open

- **11.1 Jurisdiction (1.1)** — **RESOLVED: Bangladesh.** Legal follow-ups
  with counsel are noted in 1.1; none is a V1 blocker.
- **11.2 Automated dormancy policy (2.3)** — before scaling past pilot.
- **11.3 Soft-delete grace length N (5.2)** — **RESOLVED: 7 days.**
- **11.4 Recipient-fallback silence window (spec §7)** — **RESOLVED: 14
  days**, comfortably under the 30-day post-release purge (5.1).
- **11.5 Content-model detail (9.1)** — **PARTLY RESOLVED:** formats,
  versioning, encryption-envelope shape, addressing, and the freeze rule are
  fixed in the Phase C `Payload` schema (`src/domain/payload.ts`). Numeric
  **size limits remain OPEN** — supplied per deployment as a `ContentPolicy`,
  not invented in code.
- **11.6 Minors / legal capacity** — whether account holders, contacts, or
  recipients may be minors; decide with jurisdiction (1.1) and counsel.

---

## Safe to build against now

- **V1 shape:** infrastructure + manual operations (Area 0). Code enforces
  timers, cancel, quorum threshold, and the audit log; humans verify and
  decide.
- **HOLD mandatory**, operator-started, 30-day window, one-tap cancel
  throughout (0.1).
- Operator must log **≥3 confirmations from ≥3 different groups** before
  HOLD starts (10.2); invariant 4 enforced in the console.
- Merged trustee/recipient roles with self-dealing guard (10.3).
- Company-held envelope encryption (8.1); manual audited account recovery
  (8.2).
- Recipient release via gated page + separate-channel one-time code, 72h
  re-issuable (4.2); no operator ever speaks a link/code/content
  (invariant 6, 4.1).
- Retention: 30-day post-release then purge (5.1); soft-delete-then-hard
  for living users, 7-day grace (5.2); metadata-only audit log, 2 years
  (5.3).
- Launch jurisdiction Bangladesh (1.1); recipient fallback after 14 days of
  silence (spec §7); pilot scale (7.1).
- Business-hours support + always-on tokenized self-serve cancel (6.1).
- Pilot scale, founder-run operator review, everything fails safe toward
  delay (7.x).
- No AI vendors; email/SMS/storage only, weekly health-checked (3.x).

---

## 12. Build phases (engineering roadmap)

A record of what has been built and what comes next. Phases are engineering
groupings, not new product decisions — none introduces a timer, threshold, or
policy the spec does not already state. Each phase must uphold every invariant
in `CLAUDE.md` / `PRODUCT_SPEC.md §9`; the ordering follows the one rule (a
false positive is catastrophic), so the audit trail and the cancel path come
first.

### Phase A — Product decisions — **DONE**
This document. Settled the V1 shape, the pivot to manual operations, quorum,
retention, and the invariants to build against.

### Phase B — UX specification — **DONE**
`UX_SPEC.md`. The four surfaces (user app, cancel link, operator console,
recipient page) and the interface expression of every invariant.

### Phase C — Core domain, tests-first — **DONE**
Pure, in-memory, fully tested (`src/`, 139 tests, CI green). Delivered:
- the eight-state machine behind one guarded `transition` (`src/domain/`),
- the immutable, metadata-only audit log,
- the `Payload` content schema (shape fixed; size limits are deployment config, 11.5),
- the operator console (`src/console/`) — group-from-roster, consent/stale gates, quorum meter, self-dealing,
- the private-release delivery engine (`src/delivery/`) — ordered delivery, channel separation, 72h codes, 14-day fallback, revocation,
- notification cadence + static templates (`src/notifications/`),
- the signed no-login cancel token (`src/cancel/`),
- the weekly health check (`src/health/`) and the retention lifecycle (`src/retention/`).

**Not in Phase C (deliberately):** persistence, a runtime that fires timers,
HTTP surfaces, real vendor integrations, encryption implementation, auth. Those
are the phases below.

### Phase D — Durability & persistence — **DONE**
`src/persistence/` (23 tests, CI green). Delivered:
- **Append-only, tamper-evident audit store (invariant 7).** `HashChainedAuditStore`
  satisfies the domain `AuditSink` interface, so it drops in wherever the
  in-memory `AuditLog` was used. Every record carries `hash = H(prevHash · record)`
  — a hash chain, so any edit, deletion, or reorder breaks the chain and is
  detected on load (`AuditIntegrityError`) or by `verify()`; a broken chain is
  refused, never silently trusted. Durability rides on an `AppendOnlySink`
  (in-memory for tests, JSONL file for production). Metadata-only is enforced at
  the boundary exactly as before (`assertMetadataSafe`). Retention horizon =
  **2 years** (`AUDIT_RETENTION_DAYS`, 5.3), exposed as a query; execution of a
  prune is a Phase E scheduler concern.
- **State repositories.** Snapshot repositories over a `KeyValueStore`
  (in-memory / JSON file) for accounts, machine context (which carries
  confirmations), payloads, operator case files, and delivery records — all
  survive a restart. `MachineRepository.load` rebuilds a `Machine` via
  `Machine.restore`; further changes still go back through `apply` → `transition`.
- **Preserved:** no ad-hoc status writes (a repository only persists/reloads a
  context `transition` produced — it has no method that sets a state), and the
  content/audit separation (operational data — notes, codes, links — lives in
  the KV repositories, never in the append-only trail).

### Phase E — Runtime & scheduler — **DONE**
`src/runtime/` (26 tests, CI green). Delivered:
- **The worker that fires time events** — `Scheduler.tickAccount` advances
  `MISSED_CHECK_IN` (day 7), `REACH_VERIFYING` (day 30), the private release
  after a HOLD fully elapses, and public release after the 14-day gap. A pure
  `nextDueEvent(context, now)` planner decides what is due; the worker applies it
  through `machine.apply` → `transition` only (no ad-hoc status writes), so every
  guard still holds and the worker can never release early.
- **Weekly health check** — `Scheduler.tickHealth` runs the dependency probers
  weekly (§6), feeds the result into every account's dependency-health gate (veto
  path 3 blocks entry to VERIFYING / starting a HOLD on a broken stack), and
  alerts the team on failures.
- **Cadence senders** — `src/notifications/` schedules are wired to channels
  through a `ReminderSender`; NUDGE and HOLD cancel prompts are rendered from the
  static templates (no link/code — invariant 6) and sent once, tracked by a
  per-account tick cursor.
- **Fail-safe (invariant 5; 7.3)** — the planner never proposes an event out of
  VERIFYING or STALLED (those are human-gated), and a rejected transition stops
  the advance loop and leaves the account where it was. A worker outage only
  DELAYS events; on restart the scheduler re-derives every due timer from the
  Phase D persisted state and catches up one guarded step at a time.

### Phase F — Surfaces & API — **IN PROGRESS** (decisions in `DECISIONS_PHASE_F_G.md`)
Architecture and product decisions for this phase are settled in
`DECISIONS_PHASE_F_G.md` (Phase F, items F0–F7). Implementation has started with
the highest-SLO surface first. In brief:
- **Cancel-link endpoint + page — DONE** (6.1, F1). `src/app/` (the
  application-service tier — the only tier that mutates) + `src/http/` (thin
  transport), 22 tests, suite green. `CancelService.preview` validates without
  mutating so `GET` is side-effect free (F1.1); `CancelService.redeem` applies
  CANCEL through the guarded `transition` and persists (invariant 1, logged per
  invariant 7). The handler renders on `GET` / cancels on `POST`, is idempotent
  (F1.3), token-as-capability so no CSRF handshake, and fails safe on any bad
  token or store outage — the fallback page with the support path + in-app
  cancel never dead-ends (F1.2). The server module has no import path to any
  vendor adapter, keeping the cancel surface in its own failure domain (F1.4).
  Still to wire: the observable-SLO metrics (F7) and the deployment topology
  (F1.5, ops).
- **Service/API layer** for the four audiences: user app (check-in, people,
  authoring), operator console, recipient gated page, admin. Each endpoint maps
  to a `transition` event or console action — no surface writes state directly.
  Decided: three-tier layering (pure core → application services, the only
  mutating tier → thin HTTP transport), auth as a seam implemented in G, every
  surface fails safe (F0, F2–F7).

### Phase G — Integrations & security — **DECISIONS SETTLED** (`DECISIONS_PHASE_F_G.md`)
Architecture and product decisions for this phase are settled in
`DECISIONS_PHASE_F_G.md` (Phase G, items G1–G6); implementation follows F. The
concrete work items, now with decisions attached:
- **Vendor adapters** behind interfaces — email / SMS / storage — plugged into
  the health check's probers. No SDK import outside its adapter directory.
  Decided: dumb-pipe ports, real probers driving the existing veto path 3;
  vendor selection stays open, gated by the 1.1 cross-border check (G1).
- **Envelope encryption implementation** — the `Payload` envelope is a shape
  today; add KMS-wrapped data keys (8.1), designed so trustee key-splitting can
  be added later without a data migration. Decided: AES-256-GCM per-item data
  keys, wrap step behind an interface so Shamir replaces it with no data
  migration; plaintext never stored or logged (G2).
- **Auth** — user login, operator login + audit, manual audited account
  recovery (8.2), admin freeze surface (veto path 4). Decided: no automated
  self-serve reset (8.2), unpolicied endpoints deny, injected secrets with
  overlapping cancel-secret rotation so invariant 1 survives rotation (G3/G4).
- **Gate:** a security review of the new network + crypto + auth surface
  against the threat model before the phase is called done (G6). Content size
  limits arrive as deployment `ContentPolicy` (11.5, G5).

### Phase H — Completeness
- Public-release publish to the user-designated destination (§PUBLIC_RELEASE).
- Quarterly drill flow (§6) — the primary mitigation for contact rot.
- A full-lifecycle end-to-end test (ACTIVE → … → PRIVATE_RELEASE) exercised
  through persistence + the scheduler.

### Still-open product decisions that gate later phases
- **11.2 Automated dormancy/lapse policy (2.3)** — before scaling past pilot;
  intersects Phase E (worker) and billing.
- **11.5 Content size limits** — a `ContentPolicy` value to set before Phase G
  storage, still not invented in code.
- **11.6 Minors / legal capacity** — with counsel; gates account/recipient
  validation in Phase F.
