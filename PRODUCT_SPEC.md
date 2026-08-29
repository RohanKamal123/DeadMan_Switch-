# Legacy Vault — Product Specification (V1)

A posthumous message delivery system. A user stores photos, notes and
messages while alive. If the system and its operator team become confident
the user has died, it releases that content to people the user chose, in
an order the user chose.

The entire product is a bet on one thing: **being wrong is worse than
being slow.** Every design decision below follows from that.

**V1 is deliberately not an AI product.** There is no automated calling,
no AI voice, and no model dependency of any kind. The software builds the
infrastructure — accounts, encrypted content, liveness tracking, the HOLD
cancel window, and gated delivery — and a **small operator team verifies
and releases manually**. See `DECISIONS.md` Area 0 for the reasoning; this
spec describes the resulting V1.

---

## 1. Threat model

Before any feature, the failure modes:

| Failure | Consequence | Severity |
|---|---|---|
| False positive — releases while user alive | Irreversible privacy breach, possible legal exposure | Catastrophic |
| False negative — never releases | Product silently useless; nobody ever finds out | Severe |
| Partial release — wrong recipient | Irreversible, targeted breach | Catastrophic |
| Early release — before quorum | Same as false positive | Catastrophic |
| Trustee / operator collusion | Deliberate breach by insiders | Severe |
| Operator error — wrong "deceased" call | Same as false positive if unchecked | Catastrophic |
| Dependency rot — email/SMS/storage dies | Silent false negative | Severe |
| Contact rot — phone numbers stale | Verification impossible | Moderate, very likely |

Note the asymmetry. A release that happens 60 days late costs nothing.
A release that happens once, wrongly, cannot be undone. Delay is cheap.
Speed is expensive. Design accordingly.

Because verification is now a human judgment, two independent defenses
guard the catastrophic direction: **three confirmations from three
different groups** (§4) and the **HOLD cancel window** (§2). Neither alone
is trusted; both must pass.

---

## 2. Core state machine

Eight states. All timers reset to zero on any liveness signal. Every
transition goes through one guarded function — no ad-hoc status writes.

### ACTIVE
Normal operation. User checks in via app button, or the system observes
a passive liveness signal (see §3). Nothing is pending.

### NUDGE
Entered when a check-in is missed. **No third party is contacted in this
state.** Only the user hears anything. All messages are static,
human-written templates.

- Day 7 — in-app notification
- Day 14 — email + SMS
- Day 21 — push to secondary device, email to backup address

Exit to ACTIVE on any signal. Exit to VERIFYING at day 30.

### VERIFYING
Operator-driven verification. **No automated calls.** When a user reaches
day 30 unresponsive, the account is placed on the **operator queue**, and
a member of the team investigates manually.

- The operator works the user's contacts through the operator console,
  viewing them one at a time.
- Any outreach to a contact is performed by a **human**, not an automated
  system — a call or an email written by a person. Neither carries any
  content or link to content.
- For each contact the operator records an outcome and, where relevant, a
  **confirmation of death** with the contact's identity and group.
- The operator records a working state per contact and overall:
  `alive` / `deceased` / `accident` / `unknown`, plus free-text notes.
- Every action — who viewed a contact, who recorded a confirmation, when —
  is written to the immutable audit log.

Exit to HOLD when quorum (§4) is reached. Exit to STALLED when the
operator cannot reach quorum. Exit to ACTIVE on any user liveness signal.

### STALLED
Verification exhausted without quorum. **Frozen. Never auto-advances to
release.** Alerts the user on every channel. Requires either a user
cancel or a deliberate manual review to move.

This state exists because "we couldn't confirm it" must never be treated
as evidence of death.

### HOLD
Quorum reached and an operator has started the hold. The cancel window —
the single most important feature in the product. **An operator can only
*start* HOLD; no operator, admin, or "verified" status may skip or shorten
it.** The timer is deterministic code, not a human judgment.

- Lenient mode (quorum only): **30 days** (V1 default).
- Strict mode (death certificate required): **21 days**, and release stays
  blocked until a certificate is uploaded — may be delayed indefinitely.

Cancel prompts sent on days 1, 7, 14, 19, 20, 21 (and 25, 28, 29, 30 in
lenient mode) to: push, SMS, primary email, all secondary emails, backup
email, secondary device. Every message is one tap to stop everything.

Contacts who confirmed are also notified that a hold is running, so a
mistaken confirmer can withdraw. A withdrawal that drops the count below
quorum returns the machine to VERIFYING.

### PRIVATE_RELEASE
The chosen recipient receives:
- An email containing a link to a gated page — **no attachment, no
  content in the body**
- A one-time code by SMS to the same person, separate channel

Code expires in 72 hours, re-issuable on request. Access is logged. In V1
the operator triggers this delivery once HOLD has fully elapsed with no
cancel; the elapsed-HOLD precondition is enforced in code, not left to the
operator.

### PUBLIC_RELEASE
Only if the user explicitly enabled it. Occurs 14 days after
PRIVATE_RELEASE. Publishes to the user-designated destination.

The gap exists as one final chance to catch a wrong release before it
is on the open internet.

### CANCELLED
Reachable from **every** state, with no conditions, no exceptions, no
grace period, no "too late." Including one second before
PRIVATE_RELEASE fires.

On entry: wipe all confirmations, reset all timers, return to ACTIVE,
notify all contacted contacts that the alert was false.

---

## 3. Liveness signals

The user should almost never reach NUDGE while healthy. Anything below
resets the clock:

- Explicit "I'm alive" tap in the app (primary, weekly)
- App open + authenticated session
- Reply to any system email
- Optional passive signals the user opts into: phone unlock heartbeat,
  linked-account activity

Passive signals are opt-in and never sufficient on their own to *trigger*
anything — they only ever reset, never advance.

---

## 4. Quorum rules

**Three confirmations required, entered manually by the operator.**
Constraints:

- **Group diversity** — contacts are assigned to groups at setup
  (family / colleague / friend / other). **No two of the three required
  confirmations may come from the same group.** This defeats the "one
  person, three phones" attack and reduces collusion risk. The console
  blocks the start of HOLD until three confirmations from three distinct
  groups are recorded.
- **Recorded identity trail** — the operator records each confirmation
  with the contact's identity, group, the recording operator, and a
  timestamp, written immutably. The call or email only *prompts*; the
  logged operator entry is the trail.
- **Consent at enrollment** — every contact opts in when added,
  acknowledging they may be contacted by the team. A consent timestamp is
  stored. (V1 outreach is human, not automated, which is far less
  regulated; the timestamp keeps the door open to stricter modes later.)
- **Withdrawal** — any confirmer may withdraw during HOLD. The operator
  records the withdrawal; dropping below 3 returns the machine to
  VERIFYING.
- **Self-dealing guard** — a person may be both a confirmer and a
  recipient, but a person's own confirmation is **never** counted toward a
  release that delivers content to that same person.

### Evidence modes

Set by the user at setup, in plain language, stored with the account:

- **Strict** — a death certificate upload is required before release.
  Release may be delayed indefinitely if nobody uploads one. HOLD 21 days.
- **Lenient** (V1 default option) — quorum alone releases. A coordinated
  mistake or lie can release early. Compensated by a longer HOLD, 30 days.

The user must see that trade-off written out and choose deliberately.

---

## 5. Veto paths

Ordered by authority:

1. **User liveness signal** — instant, total, from any state. Overrides
   everything.
2. **Confirmer withdrawal** — drops quorum, HOLD → VERIFYING.
3. **Failed health check** on a critical dependency (email / SMS /
   storage) — blocks entry to VERIFYING until resolved. Never start
   reaching out on a broken notification stack.
4. **Admin freeze** — fraud report or legal hold. Manual, audited.

---

## 6. System health

Two independent layers.

**Automated, weekly, invisible to the user:**
- Ping every external dependency (email, SMS, storage)
- Send a real test email + SMS to a company-owned address/number and
  verify actual deliverability (not just "accepted")
- Verify stored payloads are readable and decrypt correctly
- Alert the operator team only on failure
- (No automated test *call* — there is no telephony/AI-voice dependency in
  V1.)

**User-facing drill, quarterly:**
- A real test email/SMS to one contact, and a labelled operator courtesy
  call where appropriate, clearly marked as a drill, requiring no action
- Confirms numbers still work and contacts still remember the arrangement

Contact details rotting is far more likely than a dependency breaking.
The drill is aimed at the human failure, not the technical one.

---

## 7. Content and delivery

- Content is stored encrypted. Delivery is via a gated page, never a raw
  attachment or a URL spoken aloud.
- Any call — automated or by a human operator — carries a spoken message
  only. **No URL, no code, no content, ever.**
- Emails carry a link to a gated page. No content in the body.
- Access to a released page is logged and revocable by an admin.

Ordering of recipients is strictly user-defined, with automatic fallback
to the next recipient after N days of silence. **No randomization
anywhere in the death path.** Random ordering means random reliability.

---

## 8. Explicitly out of scope for V1

Deferred, with reasons, so they don't get quietly forgotten:

- **AI voice, automated calling, and any model dependency** (Gemini,
  DeepSeek, etc.) — V1 verification and outreach are manual. Reintroducing
  automation later goes through the `src/adapters/models/` boundary and
  may never let model output advance a state transition.
- Auto-posting to social platforms — accounts get memorialized or locked,
  OAuth tokens expire, credential storage violates ToS
- Shamir key-splitting across trustees — right answer for
  company-independence, wrong complexity for V1
- Permanent decentralized storage (Arweave / IPFS)
- Death certificate forgery detection beyond basic manual review

Not deferred, must ship in V1: the legal layer. The user's will should
name the trustees and grant the executor authority over digital assets.
Without it, a silent trustee or a locked registrar strands everything
regardless of code quality. (V1 provides advisory guidance; see
`DECISIONS.md` 1.2.)

---

## 9. Non-negotiable invariants

If a code change would break any of these, the change is wrong:

1. CANCELLED is reachable from every state, unconditionally.
2. No third party is contacted before day 30.
3. No content is released before a HOLD window has fully elapsed.
4. No two quorum confirmations from the same trustee group.
5. STALLED never auto-advances toward release.
6. No content, URL, or access code is ever spoken on a call.
7. Every outreach attempt and every state transition is logged
   immutably.
