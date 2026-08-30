# Legacy Vault — Phase C: the state machine

Posthumous message delivery (V1, manual / no-AI). This phase implements the
core the rest of the product is built on: the **eight-state machine**, the
**immutable audit log**, and the **`Payload` content schema** — written
tests-first, because everything here touches the release path where *being
wrong is worse than being slow*.

Read `PRODUCT_SPEC.md` (behaviour + invariants), `DECISIONS.md` (why), and
`CLAUDE.md` (the one rule + invariants) before changing anything.

## Layout

```
src/domain/
  states.ts      # the 8 states, groups, evidence modes
  config.ts      # decided timer values — each traces to a spec/decision line
  quorum.ts      # quorum counting + self-dealing guard (pure)
  audit.ts       # append-only, metadata-only audit log
  transition.ts  # THE single guarded transition function (pure)
  machine.ts     # stateful runner: applies transitions, appends the audit log
  payload.ts     # Phase C content schema (shape fixed; size limits are config)
src/console/
  contacts.ts    # contact roster: roles, groups, consent, stale flag
  quorum-meter.ts# read-models: quorum meter, hold readiness, self-dealing
  console.ts     # OperatorConsole: fires machine events with UI guardrails
src/delivery/
  codes.ts       # one-time codes: 72h expiry, single-value match
  messages.ts    # channel message shapes: email=link only, sms=code only
  release.ts     # ReleaseController: ordered delivery, fallback, gated access
src/adapters/models/   # empty by design — no AI/model dependency in V1
tests/                 # tests-first suite; one file per invariant + units
```

## The design in one paragraph

State only ever changes through `transition(machine, event)`. It is pure —
no mutation, no IO — and returns either an accepted result (a new immutable
machine, the side-effects to perform, and the audit entry to log) or a
rejection that leaves the machine untouched. There are **no ad-hoc status
writes** anywhere. `Machine` is the only stateful wrapper: on an accepted
transition it swaps in the new context and appends to the audit log. When a
guard is ambiguous, the conservative (non-releasing) branch is taken.

## Invariants → tests

Every invariant in `PRODUCT_SPEC.md §9` has a dedicated suite:

| # | Invariant | Test |
|---|---|---|
| 1 | CANCELLED reachable from every state, unconditionally | `tests/invariants/invariant-1-cancel-reachable.test.ts` |
| 2 | No third party contacted before day 30 | `tests/invariants/invariant-2-no-contact-before-30.test.ts` |
| 3 | No release before the HOLD window fully elapses | `tests/invariants/invariant-3-no-release-before-hold.test.ts` |
| 4 | No two quorum confirmations from the same group | `tests/invariants/invariant-4-group-diversity.test.ts` |
| 5 | STALLED never auto-advances toward release | `tests/invariants/invariant-5-stalled-never-advances.test.ts` |
| 6 & 7 | Immutable, metadata-only audit log (no content/URL/code) | `tests/invariants/invariant-6-7-audit.test.ts` |

## Operator console (`src/console/`)

The pivot to manual operations changes what *fires* the machine's events — an
operator action — not the transition table or the invariants (DECISIONS.md
10.4). `OperatorConsole` is that surface, and it adds structural guardrails on
top of the machine:

- a confirmation's **group is read from the enrolled roster**, never typed by
  the operator, so group diversity (invariant 4) cannot be faked;
- only a **consented, non-stale confirmer** can be recorded (1.3 / 4.3);
- the **quorum meter** shows distinct *groups*, not a raw count, and hold
  readiness explains exactly why Start-HOLD is disabled (§3.3 / §3.4);
- **self-dealing** eligibility is surfaced per recipient (10.3);
- there is **no field to attach a link, code, or content to outreach** — the
  console records outcomes, not messages (invariant 6);
- free-text notes live in the operational case file; the audit log gets
  **metadata only** (invariant 7 / 5.3).

## Release delivery (`src/delivery/`)

Runs only once the machine is in `PRIVATE_RELEASE` (the HOLD window fully
elapsed with no cancel — enforced upstream). `ReleaseController`:

- delivers to recipients in **strict user order**, no randomisation (§7);
- **skips a self-dealing recipient** — one whose own confirmation was needed
  for quorum (10.3), recomputed with their confirmation excluded;
- issues an **email (gated link) + SMS (one-time code) on separate channels**;
  the message *shapes* make invariant 6 structural — an email has no field that
  could carry a code or content, an SMS none that could carry a link. Content
  is revealed only at the gated page after **both** are presented;
- **falls back to the next recipient after 14 days of silence** (11.4), and
  stops advancing once the active recipient has accessed their content;
- **re-issues an expired code within the 30-day retention window** (5.1);
- logs every access as **metadata only** and honours **admin revocation**.

Code and link generators are injected (deterministic in tests); public-release
publishing to the user-designated destination is a separate destination step
and is not part of this gated-delivery module.

## Deferred / config, not invented

Numeric content size limits are **not** hard-coded (CLAUDE.md forbids inventing
a threshold the spec is silent on; `DECISIONS.md` 11.5 leaves them open). The
`Payload` schema fixes the *shape* — kinds, encryption envelope, addressing,
versioning, the HOLD freeze rule — and limits arrive as a caller-supplied
`ContentPolicy`, to be set per deployment.

## Commands

```
npm install
npm test         # jest
npm run typecheck
```
