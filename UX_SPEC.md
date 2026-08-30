# Legacy Vault — UX Specification (V1, Phase B)

How the product looks and behaves, screen by screen. This is the design
layer that sits on top of the state machine and decisions already settled.

**Read first:** `PRODUCT_SPEC.md` (behaviour and invariants) and
`DECISIONS.md` (why). This document does not re-decide anything settled
there; it describes the interface that expresses those decisions. The
timer values it depends on are now decided — recipient-fallback window
**14 days** (`DECISIONS.md` 11.4), soft-delete grace **7 days** (5.2/11.3),
launch jurisdiction **Bangladesh** (1.1). For any value not yet decided,
the UX shows the *configured* value and never hard-codes a number —
inventing an unspecified timer is forbidden by `CLAUDE.md`.

## The one rule, in interface terms

Being wrong is worse than being slow. In the UX this means:

- **Cancel is never more than one tap away, from anywhere, ever.** No
  screen, modal, or state hides it, greys it out, or adds a
  "are you sure?" that could cost a living user the save (invariant 1).
- **Nothing irreversible is presented as fast or frictionless.** Release-
  advancing actions carry deliberate friction; the cancel path carries
  none.
- **The interface never claims certainty it does not have.** Copy says
  "we have not heard from you," never "you have died." Operator copy says
  "unconfirmed," never "confirmed dead" until quorum is recorded.
- **All user-facing copy is static, human-written template text**
  (`DECISIONS.md` 3.1). No screen generates language at runtime.

---

## 0. Audiences and surfaces

Four distinct surfaces, four distinct audiences. They never share a
screen.

| Surface | Audience | Purpose | Auth |
|---|---|---|---|
| **User app** | Account holder (alive) | Author content, manage people, stay alive, cancel | Full login |
| **Cancel link** | Account holder (alive) | Stop everything, no login | Signed single-purpose token |
| **Operator console** | Operator team | Verify, record confirmations, start HOLD, trigger release | Operator login + audit |
| **Recipient page** | Recipient (posthumous) | Receive released content | Gated link + one-time code |
| **Contact touchpoints** | Contacts/confirmers | Consent, confirm, withdraw, drill | Email/SMS, no app account |

Design each for its worst moment: the user tapping cancel in a panic at
2am; the operator deciding whether a stranger on the phone counts as a
confirmation; the recipient opening a message from someone who has died.

---

## 1. User app

### 1.1 Onboarding

Onboarding is where the user makes the two choices that shape everything
downstream. It is deliberately not a quick signup. Order:

1. **Account + identity.** Email, phone, password. Establishes the primary
   liveness channels.
2. **What this is.** One plain-language screen: "If we and our team become
   confident you have died, we release what you have stored to the people
   you choose. We would rather be slow than wrong. You can stop the process
   at any moment, from any message, with one tap." Sets expectations before
   any commitment.
3. **Evidence mode — deliberate choice, trade-off shown in full.** The user
   must read both options written out and pick (spec §4, `DECISIONS.md`
   0.1). Not a toggle with a default hidden in settings.
   - **Lenient (default option):** "Three people who knew you, from three
     different groups, is enough to begin. This can be wrong if people are
     mistaken or coordinate a lie — so the cancel window is longer:
     **30 days**." 
   - **Strict:** "Same three confirmations, **and** someone must upload a
     death certificate before anything is released. Nothing releases
     without it — possibly never. Cancel window **21 days**."
   - The screen states plainly that lenient can release on a coordinated
     mistake and strict can delay forever. The user chooses knowing both
     failure modes. Choice is stored with the account and shown in settings
     thereafter (changeable, logged).
4. **People.** Add contacts and recipients (§1.3).
5. **Legal advisory.** Prominent, not buried (`DECISIONS.md` 1.2): guidance
   on naming trustees in a will and granting the executor authority over
   digital assets, with a plain warning that the product cannot force a
   silent trustee or a locked registrar to act. Advisory only — the product
   does not generate or store legal instruments. Repeated in the quarterly
   drill.
6. **Public release — off by default.** A separate, explicit opt-in
   (spec §PUBLIC_RELEASE) with its own trade-off copy: "14 days after your
   chosen people receive their content, this is published to the open
   internet. This is the one step that cannot be pulled back once it
   happens." Off unless the user turns it on deliberately.
7. **First check-in.** The user taps "I'm alive" once to learn the gesture,
   and sets the weekly cadence expectation.

### 1.2 Home / liveness

The home screen's entire job is to make staying alive effortless and to
make the current state legible.

- **State banner, always visible.** Plain-language status: "All good — last
  check-in 3 days ago" (ACTIVE) … "We haven't heard from you" (NUDGE) …
  "We're looking into whether you're okay" (VERIFYING) … "A hold is
  running — tap to stop everything" (HOLD). Never uses the internal state
  names to the user.
- **The check-in button is the largest, most reachable element.** A single
  "I'm alive" tap resets every timer (spec §3). Confirmation is immediate
  and reassuring: "Thanks — clock reset. Next check-in due in 7 days."
- **Passive signals (opt-in).** A settings panel lists opt-in passive
  liveness signals (phone-unlock heartbeat, linked-account activity) with
  copy stating clearly they only ever *reset* the clock and can never *by
  themselves* trigger or advance anything (spec §3). Off by default.
- **What happens if I stop checking in.** A calm, always-available
  explainer screen showing the timeline (day 7 / 14 / 21 reminders, day 30
  review) so the process is never a surprise.

### 1.3 People — contacts and recipients

A person may be both a confirmer and a recipient (`DECISIONS.md` 10.3); the
UI treats these as two roles on one person, not two separate lists.

Per person the user sets:
- **Name and reach** — email and/or phone.
- **Group** — family / colleague / friend / other. The UI explains *why*
  group matters in plain terms: "We require confirmations from people in
  different groups, so no single person — or one person with several
  phones — can trigger this alone" (invariant 4, spec §4). Group is
  mandatory; a person cannot be saved without one.
- **Role(s)** — confirmer (may be contacted to confirm), recipient
  (receives content), or both.
- **Consent state** — every person added is sent an enrollment consent
  request; their consent timestamp is stored (`DECISIONS.md` 1.3). Until
  consent is recorded the person shows a "consent pending" chip. The UI
  never hides that a person has not yet consented.

**Self-dealing guard, surfaced.** When a person is both a confirmer and a
recipient, the UI notes inline: "Because {name} also receives content,
their own confirmation won't count toward releasing to them" (invariant
via `DECISIONS.md` 10.3). The user sees the guard, so it is not a silent
surprise.

**Recipient ordering.** Recipients are placed in a strict, user-defined
order — a drag-to-reorder list, no randomisation offered anywhere
(spec §7). Copy explains fallback: "If {first recipient} doesn't respond
within **14 days**, we move to the next" (recipient-fallback silence
window, `DECISIONS.md` 11.4). The 14-day window sits comfortably inside the
30-day post-release retention (5.1) so a fallback recipient still has real
access time.

### 1.4 Content authoring (resolves `DECISIONS.md` 9.1 UX)

The authoring surface, per the captured intent in `DECISIONS.md` 9.1.

- **Notepad.** A plain writing surface for composing a message directly in
  the app. Autosaves as an encrypted draft; the user sees a "saved" state,
  never a raw storage detail.
- **Upload.** Photos and PDFs (the formats named in the spec intro and
  9.1). Each stored item shows type, size, and the recipient(s) it is
  addressed to.
- **Addressing.** Each content item is addressed to one or more recipients
  from the People list. Nothing is stored unaddressed at release time; the
  UI flags "not addressed to anyone" as an incomplete item.
- **Edit-after-save.** Content is editable while the user is ACTIVE. The UI
  states that edits stop being possible once a hold is running — during
  HOLD the vault is frozen for authoring so content cannot be changed while
  a release is pending. (Formats, size limits, and versioning detail are
  finalised with the Phase C `Payload` schema per `DECISIONS.md` 9.1/11.5;
  this spec fixes the *interface* shape, not the storage limits.)
- **Encryption is invisible but stated.** A short, honest line: "Everything
  here is stored encrypted. Our team holds the keys in V1 — see security."
  Links to plain-language security copy reflecting company-held envelope
  encryption and its accepted residual risk (`DECISIONS.md` 8.1). No false
  end-to-end claims.

### 1.5 NUDGE — the user, and only the user, hears from us

NUDGE screens are static templates (spec §NUDGE, `DECISIONS.md` 3.1) and
reach only the user. The UI reinforces that no one else has been contacted:
every NUDGE message and in-app banner says so explicitly — "We haven't
contacted anyone else" — because a living user's first fear is that their
people are being alarmed prematurely (invariant 2).

- **Day 7** — in-app notification.
- **Day 14** — email + SMS.
- **Day 21** — push to secondary device + email to backup address.

Each carries one obvious action: check in. Each also carries the cancel/
"I'm here" affordance. Tone is warm and low-alarm, never accusatory.

### 1.6 HOLD — the cancel window, the most important screen in the product

When a hold is running the user's every channel carries a one-tap stop
(spec §HOLD; cadence: days 1, 7, 14, 19, 20, 21, plus 25, 28, 29, 30 in
lenient mode). The interface treats this as the product's highest-priority
surface.

- **The stop control is unmissable and singular.** One primary button:
  "I'm alive — stop everything." No competing calls to action on the
  screen. No confirmation step that could fail. One tap cancels
  (invariant 1).
- **Plain, non-frightening explanation.** "A hold is running because we
  weren't able to confirm you're okay. Nothing has been released. If you're
  reading this, tap the button and it all stops." The copy never asserts
  the user is dead.
- **Time remaining is shown but never a countdown-to-doom.** "This hold
  ends in {days}. You can stop it at any point, including the last second."
  Directly mirrors the spec's "one second before PRIVATE_RELEASE" guarantee.
- **Reachable when logged out.** The same stop is available through the
  signed cancel link (§2) with no login, because a panicking or locked-out
  user must never be blocked from cancelling (`DECISIONS.md` 6.1).

### 1.7 STALLED and other states, from the user's side

- **STALLED** presents to the user as an urgent, all-channel alert: "We
  tried to reach people and couldn't confirm anything. Nothing will be
  released. Please check in or contact us." The copy makes explicit that
  inability to confirm is *not* being treated as evidence of death
  (spec §STALLED, invariant 5) — the state never advances on its own, and
  the UI never offers the user or anyone else a "proceed anyway" button.
- **CANCELLED** returns the user to a clean ACTIVE home with a reassuring
  summary: "Everything's stopped and reset. We let the people we'd
  contacted know it was a false alarm." (spec §CANCELLED).

### 1.8 Settings, recovery, deletion

- **Account recovery is deliberately manual.** No self-serve reset button.
  The recovery screen explains: "For your safety, resets are done by a
  person who verifies your identity. This is slower on purpose — it means
  no attacker can reset their way into your account and force a release"
  (`DECISIONS.md` 8.2). Provides the contact path; the action is logged.
- **Self-deletion while alive.** Soft delete with a **7-day** grace period,
  then hard delete (`DECISIONS.md` 5.2). The UI states content is erased on
  hard delete, that the account is recoverable for 7 days (manual, audited
  recovery per 8.2), and that the audit log keeps metadata only, never
  content.
- **Support.** Business-hours human support surfaced here, alongside the
  always-on self-serve cancel, which is presented as the thing that never
  waits for a human (`DECISIONS.md` 6.1).

---

## 2. The cancel link (no-login, 24/7)

A single-purpose surface reached from any HOLD/NUDGE message via a signed
token (`DECISIONS.md` 6.1). Its uptime is the project's highest SLO, and
its UX is correspondingly minimal.

- **One screen, one action.** "Stop everything and reset" — a single large
  control. On success: "Done. Everything is stopped. You don't need to do
  anything else." No login, no account navigation, no upsell.
- **Fail-safe copy on a bad/expired token.** If the token can't be
  validated, the page does not dead-end: it shows the support path and the
  in-app cancel as fallbacks, so a living user is never left without a way
  to stop the process.
- **Nothing sensitive on the page.** No content, no recipient names, no
  codes — the link only cancels (consistent with invariant 6's spirit that
  channels never leak content).

---

## 3. Operator console

The console is where humans do the verification the software will not
automate. Its UX exists to make the *careful* path the easy path and the
*dangerous* path deliberately hard — the interface, not just policy,
enforces the invariants.

### 3.1 Operator queue

- A list of accounts that reached day 30 unresponsive (spec §VERIFYING;
  entry to the queue is the day-30 boundary, never earlier — invariant 2).
- Health gate: if a critical dependency (email/SMS/storage) health check is
  failing, the console **blocks starting verification** and shows why
  (spec §5 veto path 3, `DECISIONS.md` 3.2). "Don't start reaching out on a
  broken notification stack" is enforced in the UI, not left to memory.
- No auto-prioritisation that could be read as urgency to release. The
  queue is a worklist, not a countdown.

### 3.2 Verifying a user — contacts one at a time

Per `DECISIONS.md` 10.1, the console shows the user's contacts **one at a
time**, never a bulk grid that invites rushed batch judgments.

Per contact card:
- Identity, group, consent state, and reach (email/phone).
- **A human-outreach reminder banner, always present:** "You may explain
  the situation. You must never read out a link, a code, or any content"
  (invariant 6, `DECISIONS.md` 4.1). The console has no field into which a
  link or code could be pasted for outreach — the guardrail is structural.
- **State tag** per contact: `alive` / `deceased` / `accident` / `unknown`.
- **Free-text note field.**
- **Record a confirmation** action (§3.3), available only where relevant.
- Every view and entry is written to the immutable audit log; the card
  shows "your actions here are recorded" (invariant 7).

An **overall state tag** and overall notes for the account sit above the
per-contact cards.

### 3.3 Recording confirmations and the quorum meter

The single most safety-critical operator interaction.

- Recording a confirmation captures the contact's **identity, group,
  recording operator, and timestamp**, written immutably (`DECISIONS.md`
  4.1). The prompt states clearly that the logged entry — not the phone
  call — is the trail.
- A **quorum meter** shows progress toward release-eligibility: 3
  confirmations from 3 **distinct groups** (spec §4, `DECISIONS.md` 10.2).
  The meter shows groups, not just a count, so an operator sees at a glance
  that two family confirmations still count as one group.
- **Group-diversity is enforced in the UI, not advised.** If a third
  confirmation would come from an already-used group, the console does not
  count it toward quorum and says why: "This would be a second {group}
  confirmation. Quorum needs three different groups" (invariant 4).
- **Self-dealing guard, enforced at counting time.** A person's own
  confirmation is visibly excluded from quorum for any release that
  delivers to that same person, with an inline explanation
  (`DECISIONS.md` 10.3). The excluded confirmation still shows in the
  record — it is not deleted, just not counted.
- **Stale-contact re-verification.** Where a contact's details are stale,
  an admin-assisted re-verification flow updates contact details only
  (logged) before their confirmation can count; the UI is explicit that
  re-verification never substitutes for the confirmation itself
  (`DECISIONS.md` 4.3).

### 3.4 Starting HOLD — start only, never skip or shorten

- The **Start HOLD** action is **disabled until the quorum meter shows 3
  confirmations from 3 distinct groups** (spec §HOLD, `DECISIONS.md` 0.1/
  10.2). The disabled state explains exactly what is missing.
- The action is worded "**Start** the hold," and the UI states plainly that
  starting is the operator's only power here: "You are starting the cancel
  window. You cannot skip it, shorten it, or release early — that's the
  code's job, not yours" (invariant 3, `DECISIONS.md` 0.1). There is no
  control anywhere in the console to shorten or bypass the timer, because
  none exists.
- On start, the user is pinged on every channel with the one-tap cancel;
  the console reflects "cancel window running — {days} remaining" and shows
  the deterministic end time as read-only.

### 3.5 During HOLD — confirmer notifications and withdrawal

- Confirmers are notified a hold is running so a mistaken confirmer can
  withdraw (spec §HOLD). The console provides a **record-withdrawal**
  action per confirmer.
- Recording a withdrawal that drops the count below quorum **returns the
  machine to VERIFYING** and the UI says so explicitly — the operator sees
  the hold stop and the case reopen (spec §5 veto 2, `DECISIONS.md` 10.2).
  This transition, like all others, goes through the one guarded function.

### 3.6 Strict mode — death certificate

- In strict mode, the release stays blocked until a death certificate is
  uploaded, "possibly indefinitely," and the UI states this (spec §4,
  `DECISIONS.md` 0.1). The upload slot is clearly a **precondition to
  release**, never a shortcut past HOLD — the 21-day window still runs in
  full.

### 3.7 Triggering release — the precondition is enforced in code

- The **Trigger private release** action is **unavailable until the HOLD
  window has fully elapsed with no cancel** (spec §PRIVATE_RELEASE). The
  elapsed-HOLD precondition is enforced in code; the UI merely reflects it
  — the button cannot be forced early because the guard is not in the
  button.
- On trigger, delivery follows the recipient order strictly, with fallback
  to the next recipient after **14 days** of silence (§1.3,
  `DECISIONS.md` 11.4). No randomisation control exists (spec §7).
- **Public release**, if the user enabled it, is shown as scheduled 14 days
  after private release, framed as "the last chance to catch a wrong
  release before it's public" (spec §PUBLIC_RELEASE). Until then it is
  cancellable like everything else.

### 3.8 Admin freeze, audit, fail-safe

- **Admin freeze** (fraud report / legal hold) is a manual, audited action
  available from the account view (spec §5 veto 4).
- **Audit log view.** Every operator action, view, confirmation,
  withdrawal, and state transition is visible as an immutable trail; the
  view is read-only and stores metadata only — never content, URLs, or
  codes (invariant 7, `DECISIONS.md` 5.3).
- **Everything fails safe toward delay.** Any operator gate that is
  unavailable, ambiguous, or blocked resolves toward *not* advancing —
  STALLED and admin gates never resolve toward release (invariant 5,
  `DECISIONS.md` 7.3). No console screen offers a "proceed anyway" that
  advances toward release without the recorded preconditions.

---

## 4. Recipient page (posthumous)

The recipient's experience begins with a message from someone who has died.
The UX is quiet, plain, and never leaks content into a channel it shouldn't
(invariant 6, spec §7, `DECISIONS.md` 4.2).

- **Email:** carries a link to a gated page. **No content, no attachment,
  no code in the body.** Copy is gentle and explains what this is and that
  a separate code is arriving by text.
- **SMS:** carries the **one-time code only**, to the same person on a
  separate channel. No link, no content.
- **Gated page:** the recipient opens the link and enters the code to
  authenticate. Only after both does content appear. Access is logged and
  admin-revocable.
- **Code expiry and re-issue:** the code expires in 72 hours and is
  re-issuable on request; the page offers a clear "send me a new code" path
  within the retention window (spec §PRIVATE_RELEASE, `DECISIONS.md`
  4.2/5.1).
- **Tone.** This is the most emotionally heavy screen in the product.
  Static, human-written copy; no automated language; no upsell; no
  branding noise. Just: who it's from, that they arranged this, and the
  content.

---

## 5. Contact touchpoints (non-app)

Contacts have no app account; they meet the product through email/SMS and,
where appropriate, a human operator call.

- **Enrollment consent.** When added, a contact receives a plain consent
  request: what Legacy Vault is, that the team may contact them to confirm
  a death, and a one-tap consent. The consent timestamp is stored
  (`DECISIONS.md` 1.3). Declining is respected and recorded.
- **Confirmer notification during HOLD.** A confirmer is told a hold is
  running and given a clear way to **withdraw** if they confirmed by
  mistake (spec §HOLD). The message carries no content, link to content,
  or code.
- **Quarterly drill.** A real test email/SMS to one contact and, where
  appropriate, a **clearly-labelled operator courtesy call**, marked as a
  drill requiring no action (spec §6). The drill copy repeats the legal
  advisory (name trustees / grant executor authority) since contact rot and
  stranded estates are the likeliest real failures.
- **Human-call boundary, restated for operators contacting anyone:** a call
  may explain the situation and the process and never carries a URL, a
  code, or any content (invariant 6, `DECISIONS.md` 4.1).

---

## 6. Cross-cutting UX rules

These bind every surface above.

1. **Cancel is reachable from every user-facing state, one tap, no
   grace period, no point of no return** (invariant 1). Including the
   logged-out cancel link and the final second before release.
2. **No third-party-facing screen or message exists before day 30**
   (invariant 2). NUDGE reaches only the user and says so.
3. **No release surface unlocks before its HOLD has fully elapsed**
   (invariant 3); the trigger control reflects a code-enforced
   precondition, it does not hold the precondition.
4. **Quorum group-diversity is enforced in the console UI**, not merely
   advised (invariant 4).
5. **No screen anywhere offers an auto-advance out of STALLED toward
   release** (invariant 5).
6. **No channel — email, SMS, page, or call — ever carries content, a URL,
   or a code where the invariant forbids it** (invariant 6): SMS carries
   only the code, email carries only the gated link, calls carry only
   speech.
7. **Every operator action and state transition is presented as recorded**,
   and the audit view is read-only and metadata-only (invariant 7).
8. **All user- and contact-facing copy is static, human-written template
   text** (`DECISIONS.md` 3.1) — no runtime language generation, no model
   output anywhere in the interface.
9. **No unspecified timer is ever shown as a number.** Every timer in the
   UX traces to a decided value — HOLD 30/21, NUDGE cadence, fallback
   14 days, soft-delete grace 7 days. Should any future value be undecided,
   the UI renders the configured value, never a placeholder number
   (`CLAUDE.md` working style).
10. **Accessibility and the panic case.** The check-in and cancel controls
    are the largest, highest-contrast, most reachable elements on their
    screens, usable one-handed and screen-reader-first, because they must
    work for a stressed or impaired user at the worst possible moment.

---

## 7. Open items carried into Phase C

Resolved since first draft: recipient-fallback window (14 days),
soft-delete grace (7 days), and launch jurisdiction (Bangladesh) are now
decided and rendered as concrete values above.

Genuinely remaining, carried into Phase C; none may be resolved by
inventing a number here:

- **Content-model detail** (formats, size limits, versioning) — finalise
  with the Phase C `Payload` schema (`DECISIONS.md` 9.1/11.5). This spec
  fixes the authoring *interface*, not the limits.
- **Jurisdiction-dependent copy** (Bangladesh consent wording, audit-horizon
  confirmation, Bangladesh succession-practice advisory copy, cross-border
  recipients) — legal follow-ups with counsel noted in `DECISIONS.md` 1.1;
  none a V1 blocker.
- **Minors / legal capacity** copy for account holders, contacts, and
  recipients — decide with counsel (`DECISIONS.md` 11.6).
