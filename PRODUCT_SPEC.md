# Legacy Vault — Product Specification (V1)

A posthumous message delivery system. A user stores photos, notes and
messages while alive. If the system becomes confident the user has died,
it releases that content to people the user chose, in an order the user
chose.

The entire product is a bet on one thing: **being wrong is worse than
being slow.** Every design decision below follows from that.

---

## 1. Threat model

Before any feature, the failure modes:

| Failure | Consequence | Severity |
|---|---|---|
| False positive — releases while user alive | Irreversible privacy breach, possible legal exposure | Catastrophic |
| False negative — never releases | Product silently useless; nobody ever finds out | Severe |
| Partial release — wrong recipient | Irreversible, targeted breach | Catastrophic |
| Early release — before quorum | Same as false positive | Catastrophic |
| Trustee collusion | Deliberate breach by insiders | Severe |
| Dependency rot — API/vendor dies | Silent false negative | Severe |
| Contact rot — phone numbers stale | Verification impossible | Moderate, very likely |

Note the asymmetry. A release that happens 60 days late costs nothing.
A release that happens once, wrongly, cannot be undone. Delay is cheap.
Speed is expensive. Design accordingly.

---

## 2. Core state machine

Eight states. All timers reset to zero on any liveness signal.

### ACTIVE
Normal operation. User checks in via app button, or the system observes
a passive liveness signal (see §3). Nothing is pending.

### NUDGE
Entered when a check-in is missed. **No third party is contacted in this
state.** Only the user hears anything.

- Day 7 — in-app notification
- Day 14 — email + SMS
- Day 21 — push to secondary device, email to backup address

Exit to ACTIVE on any signal. Exit to VERIFYING at day 30.

### VERIFYING
Trustee outreach. Batches of 3 contacts, 48 hours apart.

- Hard cap: 10 contacts attempted
- Hard cap: 21 days elapsed
- Each contact gets a call (pre-recorded message, no URL spoken) and an
  email. Neither contains any content or link to content.
- Each attempt is logged: timestamp, channel, outcome
  (`answered` / `voicemail` / `no_answer` / `bounced` / `invalid`)
- Failed contacts retried on an alternate channel, 3 attempts across
  3 days, then marked `exhausted`

Exit to HOLD on quorum. Exit to STALLED on cap. Exit to ACTIVE on user signal.

### STALLED
Outreach exhausted without quorum. **Frozen. Never auto-advances to
release.** Alerts the user on every channel. Requires either a user
cancel or a manual human review to move.

This state exists because "we couldn't reach anyone" must never be
treated as evidence of death.

### HOLD
Quorum reached. The cancel window — the single most important feature
in the product.

- Strict mode (death certificate required): 21 days
- Lenient mode (quorum only): 30 days

Cancel prompts sent on days 1, 7, 14, 19, 20, 21 (and 25, 28, 29, 30 in
lenient mode) to: push, SMS, primary email, all secondary emails, backup
email, secondary device. Every message is one tap to stop everything.

Trustees are also notified that a hold is running, so a mistaken
confirmer can withdraw.

### PRIVATE_RELEASE
The chosen recipient receives:
- An email containing a link to a gated page — **no attachment, no
  content in the body**
- A one-time code by SMS to the same person, separate channel

Code expires in 72 hours, re-issuable on request. Access is logged.

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
notify all contacted trustees that the alert was false.

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

Three confirmations required. Constraints:

- **Group diversity** — trustees are assigned to groups at setup
  (family / colleague / friend / other). No two confirmations may come
  from the same group. This defeats the "one person, three phones"
  attack and reduces collusion risk.
- **Authenticated confirmation** — the call only *prompts*. The actual
  confirmation happens via a unique authenticated link or one-time code,
  producing an identity trail.
- **Consent at enrollment** — every trustee must opt in when added,
  acknowledging they may be called by an automated system. This is a
  legal requirement in most jurisdictions for automated calls, not a
  nicety.
- **Withdrawal** — any trustee may withdraw a confirmation during HOLD.
  Dropping below 3 returns the machine to VERIFYING.

### Evidence modes

Set by the user at setup, in plain language, stored with the account:

- **Strict** — a death certificate upload is required before release.
  Release may be delayed indefinitely if nobody uploads one.
- **Lenient** (V1 default option) — quorum alone releases. A coordinated
  mistake or lie can release early. Compensated by a longer HOLD.

The user must see that trade-off written out and choose deliberately.

---

## 5. Veto paths

Ordered by authority:

1. **User liveness signal** — instant, total, from any state. Overrides
   everything.
2. **Trustee withdrawal** — drops quorum, HOLD → VERIFYING.
3. **Failed health check** on a critical dependency — blocks entry to
   VERIFYING until resolved. Never start calling people on a broken
   telephony provider.
4. **Admin freeze** — fraud report or legal hold. Manual, audited.

---

## 6. System health

Two independent layers.

**Automated, weekly, invisible to the user:**
- Ping every external API (telephony, email, SMS, storage)
- Place a real test call to a company-owned number
- Verify stored payloads are readable and decrypt correctly
- Verify email deliverability (not just "accepted" — actually delivered)
- Alert the user only on failure

**User-facing drill, quarterly:**
- A real test call and email to one trustee, clearly labelled as a drill,
  requiring no action
- Confirms numbers still work and trustees still remember the
  arrangement

Trustee contact details rotting is far more likely than an API breaking.
The drill is aimed at the human failure, not the technical one.

---

## 7. Content and delivery

- Content is stored encrypted. Delivery is via a gated page, never a raw
  attachment or a URL spoken aloud.
- Calls carry a pre-recorded message only. No URL, no code, no content.
- Emails carry a link to a gated page. No content in the body.
- Access to a released page is logged and revocable by an admin.

Ordering of recipients is strictly user-defined, with automatic fallback
to the next recipient after N days of silence. **No randomization
anywhere in the death path.** Random ordering means random reliability.

---

## 8. Explicitly out of scope for V1

Deferred, with reasons, so they don't get quietly forgotten:

- Auto-posting to social platforms — accounts get memorialized or locked,
  OAuth tokens expire, credential storage violates ToS
- Shamir key-splitting across trustees — right answer for
  company-independence, wrong complexity for V1
- Permanent decentralized storage (Arweave / IPFS)
- Death certificate forgery detection beyond basic manual review

Not deferred, must ship in V1: the legal layer. The user's will should
name the trustees and grant the executor authority over digital assets.
Without it, a silent trustee or a locked registrar strands everything
regardless of code quality.

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
