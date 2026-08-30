# Legacy Vault — V1

Posthumous message delivery (V1, manual / no-AI). The whole system is built and
tested: the **eight-state machine** and its **immutable audit log**, the
**`Payload` content schema**, the **operator console**, the **release-delivery
engine**, the **notification cadence**, the **no-login cancel link**, the
**weekly health check**, and the **retention lifecycle** (Phases C–E), plus the
**application-service tier**, the **four HTTP surfaces** (Phase F), **vendor
adapters, envelope encryption, and auth** (Phase G), and **public release,
quarterly drill, and a full-lifecycle end-to-end test** (Phase H) — all
tests-first, because everything here touches the release path where *being wrong
is worse than being slow*.

Read `PRODUCT_SPEC.md` (behaviour + invariants), `DECISIONS.md` (why + the
engineering roadmap), and `CLAUDE.md` (the one rule + invariants) before
changing anything. The network-phase architecture decisions are in
`DECISIONS_PHASE_F_G.md` (Phase F — Surfaces & API; Phase G — Integrations &
security), including the closing security review (G6).

## Architecture at a glance

Four tiers, and only the middle one mutates:

1. **Pure core** (`src/domain`, `src/console`, `src/delivery`, …) — the guarded
   state machine and every invariant. No IO.
2. **Application services** (`src/app`) — the ONLY tier that mutates: each method
   loads via a repository, calls the core, and persists. Transport-agnostic.
3. **HTTP transport** (`src/http`) — thin handlers that authenticate, parse, and
   call tier 2. No surface writes state.
4. **Adapters** (`src/adapters`) — vendor channels, envelope encryption, auth,
   secrets. Dumb pipes behind ports; no SDK escapes its directory.

`src/composition.ts` wires them into two servers — the **cancel** server (its
own failure domain) and the **main API** server — from injected secrets and
adapters. Swapping the in-memory dev adapters for real vendors is a config
change, not a code change.

## Build & test

```
npm ci
npm run typecheck   # tsc --noEmit
npm test            # jest — 359 tests, tests-first across every tier
```

## Running the service

`src/main.ts` is the entrypoint; `src/bootstrap.ts` assembles the whole system
(the two servers — the cancel surface has its own port/failure domain, F1.4 —
plus the scheduler driver that ticks the Phase E worker on a clock).

```
npm run build
LV_CONFIG_FILE=./config.json \
LV_CANCEL_SECRET=… LV_SESSION_SECRET=… LV_KMS_MASTER_KEY=<64 hex> \
LV_TWILIO_ACCOUNT_SID=… LV_TWILIO_AUTH_TOKEN=… LV_TWILIO_FROM=… \
LV_STORAGE_BASE_URL=… LV_EMAIL_SEND_URL=… \
npm start
```

Secrets and vendor credentials come from the **environment** (never committed).
Non-secret operational values — ports, storage paths, and the deployment
**policy numbers** (content size limits 11.5, recipient attempt cap F4.1) — come
from the JSON file named by `LV_CONFIG_FILE`; see `config.example.json`. The
policy values arrive as config, never invented in code (CLAUDE.md). `SIGINT`/
`SIGTERM` stops the scheduler and closes both ports cleanly.

Not yet production-ready from this entrypoint: the public-release publisher is an
in-memory stand-in (§PUBLIC_RELEASE destination unwired), the KMS is the local
dev wrapper (G2.1), and there is no UI for the user/operator/admin JSON APIs.

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
src/notifications/
  cadence.ts     # NUDGE (7/14/21) + HOLD cancel-prompt schedules
  templates.ts   # static, human-written copy (no runtime language)
src/cancel/
  token.ts       # signed, single-purpose, no-login cancel link
src/health/
  health.ts      # weekly email/SMS/storage check; gates VERIFYING (veto 3)
src/retention/
  retention.ts   # 30-day post-release purge; 7-day soft-delete grace
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

## Notifications, cancel link, health, retention

- **`src/notifications/`** — the cadence (NUDGE day 7/14/21; HOLD cancel prompts
  on days 1/7/14/19/20/21, plus 25/28/29/30 in lenient mode) and the static,
  human-written templates (DECISIONS 3.1). No copy is generated at runtime, no
  template asserts the user has died, NUDGE copy states no one else was
  contacted, and no template embeds a URL or code.
- **`src/cancel/`** — the signed, single-purpose, no-login cancel token
  (DECISIONS 6.1). HMAC-signed; a bad token fails safe (never a crash, never a
  state change); redeeming a valid one cancels from any state. No expiry — a
  living user must always be able to stop, and a leaked token can only cancel.
- **`src/health/`** — the weekly email/SMS/storage check (§6). A failing (or
  throwing) probe marks the machine unhealthy and blocks entry to VERIFYING
  (veto path 3) until a later healthy check clears it.
- **`src/retention/`** — schedules and audited, metadata-only purge helpers:
  30-day post-release purge (5.1) and 7-day soft-delete grace before hard delete
  (5.2). A purge never touches the audit trail; only counts are logged.

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
