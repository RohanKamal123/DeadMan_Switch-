# Claude Code — Prompt Pack

Use these in order. Each assumes `PRODUCT_SPEC.md` sits in the repo root.
Run each in a fresh session; paste the prompt, let it finish, review,
commit, move on.

---

## Step 0 — Project memory

Before anything else, create `CLAUDE.md` in the repo root so every
future session inherits the rules. Paste this as the file content:

```markdown
# Project: Legacy Vault

Posthumous message delivery. Read PRODUCT_SPEC.md before any task.

## The one rule
A false positive (releasing while the user is alive) is catastrophic and
irreversible. A false negative (releasing late) is cheap. When any design
question is ambiguous, choose the slower, more conservative path.

## Invariants — never violate, never "optimize away"
1. CANCELLED is reachable from every state, unconditionally, with no
   grace period or point of no return.
2. No third party is contacted before day 30.
3. No content is released before a HOLD window has fully elapsed.
4. No two quorum confirmations may come from the same trustee group.
5. STALLED never auto-advances toward release.
6. No content, URL, or access code is ever spoken on a phone call.
7. Every outreach attempt and state transition is logged immutably.

## Model and vendor split
- Speech in and out (STT and TTS for the outreach calls): Gemini API.
- All other model work (drafting notification copy, summarizing, any
  reasoning inside the product): DeepSeek v4.
- Every model call goes through an adapter in `src/adapters/models/`.
  No SDK import anywhere outside that directory. Swapping a vendor must
  be a one-file change.
- Both are external dependencies and both are covered by the weekly
  health checks in spec §6.
- Hard rule: no model output is ever trusted to make a state decision.
  Models generate speech and text. Quorum, timers, and transitions are
  deterministic code only. A hallucinating model must never be able to
  advance the machine toward release.

## Working style
- Never introduce a timer, threshold, or delay not specified in the spec.
  If the spec is silent, stop and ask.
- Every state transition goes through one guarded function. No ad-hoc
  status writes anywhere in the codebase.
- Tests before implementation for anything touching the state machine.
- If a requested change would break an invariant, say so and stop.
```

---

## What to do after CLAUDE.md — the order that works

Do not scaffold yet. Three phases come first, and each ends in a
committed document, not code. The documents are the point: they are what
every later Claude Code session reads instead of guessing.

**Phase A — Decisions (no code, no design).** Everything currently
undecided gets decided and written down. Output: `DECISIONS.md`.

**Phase B — UI/UX (no backend).** Screens, flows, and the words on them.
Output: `UX_SPEC.md` plus a clickable static prototype. The prototype is
throwaway — its job is to make you feel the cancel flow before it costs
anything to change.

**Phase C — Data and contracts.** Schema and API surface derived from
the UX, not invented ahead of it. Output: `SCHEMA.md` and `API.md`.

Then Step 1 onward.

Two of these phases are worth doing hybrid rather than handing to Claude
Code alone. Phase A is judgment about your product and your risk
tolerance — decide it yourself in conversation, then have Claude Code
write it up. Phase B is best as a loop: you describe, it builds a static
prototype, you react. Phase C is safe to delegate almost entirely, since
by then the constraints are all written down.

---

### Phase A prompt — Decisions

```
Read PRODUCT_SPEC.md and CLAUDE.md. Write no code.

Produce DECISIONS.md. First, interview me — ask me every question you
need answered before this product can be built, grouped by area, one
area at a time. Do not guess or fill gaps with defaults.

Areas I know are open:
- Jurisdiction and legal: where I operate, what consent I need from
  trustees for automated calls, what the will/executor language must say
- Pricing and dormancy: what happens if a subscription lapses while the
  user is alive but inactive; what happens after death when nobody is
  paying
- Vendor risk: Gemini for speech, DeepSeek v4 for everything else — what
  breaks if either changes pricing, deprecates a model, or blocks my
  region
- Identity: how a trustee proves they are who they claim on the
  confirmation link
- Data retention: how long content is held after release, and before
  any release, and who can delete it
- Support: who a confused trustee calls at 2am
- Scale assumptions: expected users, calls per month, cost per death event

Find the areas I have not listed too. For each decision, record: the
question, the options, what I chose, and the reason. Where I have no
answer yet, record it as OPEN with what would resolve it — never invent
a decision on my behalf.
```

---

### Phase B prompt — UI/UX

```
Read PRODUCT_SPEC.md, CLAUDE.md and DECISIONS.md. No backend, no
database, no real logic.

Design the interface. Produce UX_SPEC.md and a static clickable
prototype (plain HTML/CSS/JS, fake data, no framework, no build step).

Screens to cover at minimum:
- Onboarding: content upload, choosing recipients, ordering them,
  assigning trustee groups
- Trustee enrollment and the consent they see when added
- The routine liveness check-in — this is the screen users see most, and
  it should take under two seconds to use
- Escalation states as the user experiences them (NUDGE reminders)
- The cancel screen during HOLD. This one matters more than everything
  else combined. Design it for a stressed person on a bad phone
  connection who may not have opened this app in a year. One tap. No
  login wall. Legible at arm's length.
- Trustee confirmation screen: what a trustee sees on the link, with the
  weight of the decision made plain
- Recipient release screen: link plus one-time code entry
- Evidence mode selection, showing the strict/lenient trade-off in plain
  language
- Health check and quarterly drill status

For each screen give: purpose, states (empty, loading, error, success),
exact copy, and what a user misreading it would cause. Write the copy as
final text, not placeholders — the wording of the cancel prompt is a
safety feature, not decoration.

Ask me for direction before designing rather than presenting a finished
opinion.
```

---

### Phase C prompt — Data and contracts

```
Read PRODUCT_SPEC.md, CLAUDE.md, DECISIONS.md and UX_SPEC.md. Still no
implementation.

Produce SCHEMA.md and API.md.

- Derive every entity and field from what the UX actually needs. If a
  field serves no screen and no invariant, leave it out.
- Mark append-only tables explicitly (StateTransition, OutreachAttempt).
- For each API endpoint: method, path, auth model, request, response,
  error cases, and which of the seven invariants it touches.
- The cancel endpoint gets its own section: it must work with no
  session, no app, and no working network on the rest of the system.
- Include the model adapter interfaces — the Gemini speech adapter and
  the DeepSeek text adapter — as contracts only, with a note that no
  adapter output may influence a state transition.

Flag anything the UX implies but DECISIONS.md left OPEN. Do not resolve
it yourself.
```

---

## Step 1 — Scaffold

```
Read PRODUCT_SPEC.md and CLAUDE.md.

Set up the project skeleton only — no business logic yet.

- TypeScript, Node, Postgres via Prisma
- Vitest for tests
- Directory layout separating: state machine core, scheduler,
  notification adapters, HTTP API, and persistence
- Prisma schema covering: User, LivenessSignal, Trustee (with group
  enum and consent timestamp), OutreachAttempt, Confirmation,
  StateTransition (append-only), Payload, ReleaseGrant

Constraints:
- StateTransition and OutreachAttempt tables are append-only. No update
  or delete paths. Enforce at the schema and repository layer.
- Notification adapters are interfaces only at this stage, with fake
  implementations for tests.

Show me the schema and directory tree before writing any other file.
```

---

## Step 2 — State machine core

```
Read PRODUCT_SPEC.md sections 2, 4 and 5.

Implement the state machine as a pure function with no I/O:

  transition(currentState, event, context) -> { nextState, effects[] }

States: ACTIVE, NUDGE, VERIFYING, STALLED, HOLD, PRIVATE_RELEASE,
PUBLIC_RELEASE, CANCELLED.

Requirements:
- Pure and synchronous. No database, no clock, no network. Time and
  quorum status arrive via the context argument.
- Effects are described, not executed — a list of intents the caller
  performs.
- Exhaustive switch on state and event. No default case that silently
  swallows unknown input; unknown combinations throw.

Write the tests first. Cover at minimum:
- LIVENESS_SIGNAL produces CANCELLED (or ACTIVE) from every one of the
  eight states, including HOLD at its final second
- VERIFYING with cap exhausted and no quorum goes to STALLED, and STALLED
  has no transition leading toward any release state
- Quorum with two confirmations from the same trustee group is rejected
- Trustee withdrawal during HOLD drops below quorum and returns to
  VERIFYING
- No path reaches PRIVATE_RELEASE without a fully elapsed HOLD

Then implement until the tests pass.
```

---

## Step 3 — Scheduler

```
Read PRODUCT_SPEC.md sections 2, 3 and 6.

Build the scheduler that drives the pure state machine.

- Evaluates due users on a tick, loads context, calls transition(),
  persists the new state and executes effects
- Idempotent: replaying the same tick must not double-send anything.
  Use an effect ledger keyed on (userId, effectType, scheduledFor).
- Crash-safe: a process dying mid-effect must not lose or duplicate work
- Health-check gate: entry into VERIFYING is blocked if any critical
  dependency health check has failed. Implement the gate now, even
  though the checks themselves come in step 5.

Explicit test: simulate a process crash between persisting a state
change and executing its effects. Assert no duplicate outreach on
restart.
```

---

## Step 4 — Outreach and confirmation

```
Read PRODUCT_SPEC.md sections 2 (VERIFYING), 4 and 7.

Implement trustee outreach.

- Batches of 3 contacts, 48 hours apart, cap 10 contacts and 21 days
- Per contact: 3 retry attempts across 3 days, alternating channel, then
  marked exhausted
- Calls carry a pre-recorded message only. Assert in code and in tests
  that no call payload can contain a URL, access code, or content — this
  is invariant 6 and must be mechanically enforced, not just documented.
- Confirmation happens on an authenticated one-time link, never on the
  call itself
- Every attempt logged with timestamp, channel, and outcome

Include a test that fails if a URL-shaped string reaches the telephony
adapter.
```

---

## Step 5 — Cancel window and health checks

```
Read PRODUCT_SPEC.md sections 2 (HOLD, CANCELLED), 5 and 6.

Two pieces.

A) The HOLD cancel window:
- 21 days strict, 30 lenient
- Cancel prompts on days 1, 7, 14, 19, 20, 21 (plus 25, 28, 29, 30 in
  lenient mode) fanned out to every channel on file
- One tap cancels: wipes confirmations, resets timers, returns to
  ACTIVE, notifies all contacted trustees the alert was false
- The cancel endpoint must be the simplest, most reliable code path in
  the system. No auth wall that could lock out a grieving-but-alive
  user; use a signed single-purpose token. Treat its uptime as the
  highest-priority SLO in the project.

B) Health checks:
- Weekly automated: ping each external API, place a real test call to a
  company-owned number, verify payload readability and decryption,
  verify email deliverability
- Quarterly user-facing drill: labelled test call and email to one
  trustee
- Failures block VERIFYING entry via the gate from step 3

Write a test asserting the cancel path works when every other subsystem
is failing.
```

---

## Step 6 — Release

```
Read PRODUCT_SPEC.md sections 2 (releases) and 7.

- PRIVATE_RELEASE: email with a link to a gated page, plus a one-time
  code by SMS on a separate channel. 72h expiry, re-issuable. No
  attachments, no content in the email body.
- PUBLIC_RELEASE: 14 days later, only if explicitly enabled
- Recipient ordering strictly user-defined, with fallback to the next
  recipient after N days of silence
- All access logged, admin-revocable

Assert in tests that no code path anywhere produces a random ordering in
the death path.
```

---

## Step 7 — Adversarial review

Run this in a fresh session once the above is built. It's the most
valuable prompt in the pack.

```
Read PRODUCT_SPEC.md, CLAUDE.md, and the full codebase.

Act as an adversary. Your goal is to find a sequence of events that
releases a living user's private content.

Consider at least:
- Race conditions between a cancel tap and a release firing
- Clock skew, timezone handling, DST, leap seconds
- Replayed or forged confirmation links
- A trustee who is also the designated recipient
- The user losing phone and email simultaneously
- Database restore from backup mid-HOLD
- Duplicate scheduler processes running concurrently
- Integer overflow or negative values in day counters
- A trustee group reassigned after confirmations were collected

For each finding: the exact sequence, which invariant it breaks, and the
minimal fix. Do not fix anything yet — produce the report first.
```

---

## Step 8 — Ongoing

Reuse for every subsequent feature:

```
Read PRODUCT_SPEC.md and CLAUDE.md first.

[feature request]

Before writing code, tell me which of the seven invariants this feature
touches and how you will preserve each. If it cannot be built without
breaking one, say so and stop.
```
