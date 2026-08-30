# Legacy Vault — Decisions (Phases F & G)

Decisions governing **Phase F — Surfaces & API** and **Phase G —
Integrations & security**, settled before either phase is built. This
document extends `DECISIONS.md` (Areas 0–12) and does not restate it; read
that first. Nothing here introduces a timer, threshold, or policy the spec
does not already state — where the spec is silent, the item is recorded
**OPEN** as deployment configuration, never invented in code (CLAUDE.md).

Status legend, cross-references, and the governing rule are identical to
`DECISIONS.md`:

- **DECIDED** — settled, safe to build against.
- **OPEN** — not yet decided; resolving action noted.

Cross-references: `PRODUCT_SPEC.md`, `UX_SPEC.md`, `CLAUDE.md` (invariants),
and `DECISIONS.md` (Areas 0–12). Governing rule: **being wrong is worse than
being slow.** These are the phases where the machine first touches the
network and real vendors, so the failure surface is at its widest; every
decision below chooses the slower, more conservative path when ambiguous.

---

## Preamble — the architectural rule these phases must not break

Phases A–E built a pure, deterministic core: an eight-state machine behind
one guarded `transition`, a hash-chained metadata-only audit log, snapshot
repositories, and a scheduler that only ever calls `machine.apply` →
`transition`. Phases F and G wrap that core in HTTP and plug in real
vendors. The single rule that makes them safe:

> **No surface and no adapter may write state.** Every endpoint maps to a
> `transition` event or a console action; every vendor is a dumb pipe. The
> HTTP layer parses and authenticates a request and then calls the same
> `machine.apply` / console methods the scheduler already calls — it has no
> other way to change a state. An email adapter sends bytes; it never
> decides anything. This keeps all seven invariants where they already live
> (in `src/domain/`) and out of the parts of the system that face the
> network.

If any Phase F/G design would require a surface to set a state directly, or
an adapter's output to gate a transition, the design is wrong — the same way
a model output advancing the machine is forbidden (CLAUDE.md).

---

# Phase F — Surfaces & API

## F0. Runtime, framework, and layering — **DECIDED**

- **Decision:** A **thin HTTP layer over an application-service layer.**
  Three tiers, already half-present:
  1. `src/domain/` + `src/console/` + `src/delivery/` — the pure core
     (built). Owns every invariant.
  2. `src/app/` (new in F) — **application services**: one method per use
     case (`checkIn`, `startVerification`, `recordConfirmation`,
     `startHold`, `triggerPrivateRelease`, `issueCancelToken`,
     `redeemRecipientCode`, …). Each loads context via a Phase D
     repository, calls the core, and persists the result. **This is the
     only tier that mutates.** It is transport-agnostic — no `req`/`res`
     leaks in.
  3. `src/http/` (new in F) — **transport**: routing, parsing,
     authentication, serialization, status codes. Calls tier 2 and returns.
     Owns no business logic and never touches a repository or the machine
     directly.
- **Framework:** the **Node built-in `http` server plus a minimal router**,
  no heavy web framework in V1. Reason: the whole surface is a handful of
  endpoints at pilot scale (7.1), the highest-SLO path (F1) must have the
  fewest moving parts and dependencies possible, and a framework is a
  supply-chain surface (G-relevant) we do not need. Revisit only if the
  endpoint count or middleware needs grow past what a small router carries
  comfortably.
- **Reason:** The layering keeps the invariants provably out of the network
  tier and makes every mutation testable without a socket. It matches the
  existing shape (the scheduler is already a tier-2-style caller of the
  core), so Phase E and Phase F share the application services rather than
  duplicating them.

## F1. The cancel endpoint ships first, and ships isolated — **DECIDED (SLO-critical)**

The self-serve cancel link is the product's highest-SLO surface (6.1,
UX §2). It is built and deployed **before any other endpoint.**

### F1.1 Route, method, and CSRF posture — **DECIDED**
- **Decision:** Two-step, on a dedicated path prefix `/cancel`:
  - `GET /cancel?t=<token>` — renders the confirm page (or the fail-safe
    page). **Read-only; changes nothing.**
  - `POST /cancel` with the token in the body — performs the cancel.
- **Reason for the split:** A raw `GET` must never mutate — link
  prefetchers, mail-scanner bots, and antivirus URL-preview fetchers follow
  `GET` links and would otherwise fire a cancel (safe direction, but it
  would reset a legitimately-running process and confuse the user). The
  `POST` requires a human to press the one large control (UX §2). Because
  the token *is* the capability and the only action it can perform is the
  safe one (cancel), **no separate CSRF token is required** — there is no
  unsafe action to protect, and demanding a login/CSRF handshake would
  violate the no-login requirement. This is the deliberate exception to the
  usual "GET is safe, POST is guarded" rule, justified by the token model
  in `src/cancel/token.ts` (no expiry; worst case is a cancel).

### F1.2 Fail-safe page is mandatory, not optional — **DECIDED (invariant 1)**
- **Decision:** A bad, expired-looking, malformed, or entirely missing
  token renders the **support path + in-app cancel fallback** (UX §2),
  never a dead-end, never a 500 that looks like the site is down. The
  handler catches everything and degrades to the fallback page. A living
  user must always have a visible way to stop the process.
- **Non-negotiable:** The cancel handler has **no dependency that can make
  it fail closed.** It does not call email/SMS/storage vendors to render;
  it needs only the signing secret and the state store. If even the state
  store is unreachable, it still renders the static fallback page with the
  support path. Invariant 1 (CANCELLED reachable from every state,
  unconditionally) is a UI-uptime property here, not just a state-machine
  property.

### F1.3 Idempotency and the double-cancel — **DECIDED**
- **Decision:** Cancelling an already-ACTIVE (already-cancelled) account is
  a **success, not an error.** The endpoint is idempotent: it reports "Done.
  Everything is stopped." whether this call or a prior one did the work. A
  user who taps twice, or taps a link from an old message, must see
  reassurance, never a scary error.

### F1.4 Deployment isolation — **DECIDED (SLO)**
- **Decision:** The cancel surface is **deployable and scalable
  independently** of the rest of the API. Its uptime is the project's
  highest SLO (6.1); it must not share a failure domain with the operator
  console, the recipient page, or vendor integrations. In V1's single
  process this means the cancel routes live in their own module with no
  import path to the vendor adapters; the deployment topology (separate
  process/host) is an ops decision recorded **OPEN (F1.5)**, but the code
  boundary that makes the split possible is built now.

### F1.5 Cancel-surface deployment topology — **OPEN**
- **Resolving action:** Ops decides whether `/cancel` runs as a separate
  process/host from the main API for true failure-domain isolation, before
  pilot launch. The code seam (F1.4) is in place either way; this is a
  deployment choice, not a code change.

## F2. The four audiences map to the machine, never around it — **DECIDED**

Per the roadmap, each surface maps to a `transition` event or a console
action. Concretely:

- **User app** (§UX 1): `checkIn` / passive-liveness ingest → the liveness
  reset event; people & authoring → Phase D repositories via app services;
  settings/recovery/deletion (§UX 1.8) → app services. **The app can only
  ever move the machine toward ACTIVE** (liveness) or edit content while not
  frozen (payload freeze rule, 9.1) — it has no endpoint that advances
  toward release. That asymmetry is enforced by which app-service methods
  the user tier is allowed to call, not by a runtime check.
- **Operator console** (§UX 3): the existing `src/console/` actions, exposed
  as authenticated endpoints. Group-from-roster, consent/stale gates, the
  quorum meter, self-dealing, and the start-HOLD block all already live in
  the console module (Phase C) — F only adds transport and operator auth
  (deferred to G3). **No console endpoint sets a state; it records
  confirmations and calls the guarded start-HOLD**, which the core still
  gates on ≥3 confirmations from ≥3 groups (invariant 4, 10.2).
- **Recipient gated page** (§UX 4): link + separate-channel code redemption
  (F4). Read-only over already-released content; it can never move the
  machine.
- **Admin** (§UX 3.8): freeze (veto path 4), audit review, access
  revocation, manual recovery (8.2). All audited (invariant 7); freeze is a
  fail-*safe* action (toward delay) so it needs no HOLD-style window.

## F3. Authentication is a seam in F, an implementation in G — **DECIDED**

- **Decision:** Phase F defines the **auth boundary** — every non-cancel,
  non-recipient endpoint requires an authenticated principal
  (`user` / `operator` / `admin`), passed to the app service so the audit
  log records *who* (invariant 7). F ships this as an **interface plus a
  dev-only stub**; the real login/session/credential implementation is
  Phase G3. Reason: keeps F shippable and testable without blocking on the
  security work, while guaranteeing no endpoint is ever written without an
  identity to log. The cancel link (no-login by design, 6.1) and the
  recipient page (capability-token, F4) are the two deliberate exceptions
  and are the *only* two.
- **Fail-safe default:** An endpoint with **no** attached auth policy is
  **denied**, not open. Adding a surface without deciding its audience fails
  closed.

## F4. Recipient gated-page mechanics — **DECIDED**

Implements 4.2 / §UX 4 as HTTP; all timers/policies already decided, F only
gives them a transport.

- **Decision:**
  - Email carries a **link to the gated page only** — no content, no code,
    no attachment (invariant 6, §7). The link's landing page asks for the
    one-time code delivered by SMS on a **separate channel** to the same
    person (4.2).
  - Code: **72-hour expiry, re-issuable** within the 30-day post-release
    window (5.1); re-issue is an app-service action, logged. Verify with a
    **constant-time comparison** and a **per-code attempt cap** (a small
    fixed number; the exact number is deployment config — F4.1) after which
    re-issue is required — throttles guessing without inventing a
    spec-silent lockout policy in the domain.
  - **Access is logged and admin-revocable** (§7, §UX 4). Every page view
    and every code redemption writes to the audit log (metadata only —
    never the content, the code, or the link; 5.3).
  - The page renders content **server-side, streamed from decrypted
    storage per view**; nothing sensitive is placed in a URL, a query
    string, or client storage (consistent with invariant 6's spirit that
    channels never leak content, UX §2/§4).
- **F4.1 — OPEN:** the numeric attempt cap and re-issue throttle are
  deployment config (a `RecipientAccessPolicy`, mirroring how content size
  limits are handled, 11.5), never a threshold invented in the domain.

## F5. Every surface fails safe — **DECIDED (invariant-preserving)**

- **Decision:** A transport-layer failure (parse error, auth error,
  repository unavailable, adapter timeout) **never advances a state and
  never releases content.** The default outcome of any error on the death
  path is *no movement* — the machine stays where it is, the scheduler
  re-derives due timers on the next tick (Phase E), and the request returns
  a safe error. This is the network-tier restatement of the one rule: an
  outage delays, it never releases. Health-gate failures specifically block
  entry to VERIFYING and starting a HOLD (veto path 3), surfaced in the
  console UI (§UX 3.1), never worked around by a retry that ignores the
  gate.

## F6. Validation, minors, and jurisdiction gates live at the app-service edge — **DECIDED (one item OPEN)**

- **Decision:** Input validation (recipient/contact shape, group
  membership, consent timestamp present) runs in the app-service tier
  before the core is called, so the pure domain keeps receiving
  already-valid data. The **minors / legal-capacity gate (11.6)** is
  enforced here at enrollment/authoring once decided with counsel — its
  *placement* is decided (app-service edge, at account/contact/recipient
  creation), its *rule* stays **OPEN** pending 11.6. Reason: deciding where
  the gate lives now means turning on the rule later is a config/policy
  change, not a re-architecture.

## F7. The cancel SLO is observable — **DECIDED**

- **Decision:** The cancel endpoint (F1) emits **uptime and latency
  signals** to the ops alerting path from day one, because "highest SLO"
  (6.1) is meaningless without measurement. These are operational metrics
  only — **never content, tokens, or account identifiers in log lines**
  (5.3, invariant 6). A cancel that errors pages the team.

---

# Phase G — Integrations & security

## G1. Vendor adapters behind ports; no SDK escapes its directory — **DECIDED**

- **Decision:** Email, SMS, and storage each sit behind a **port interface**
  in `src/adapters/<kind>/`, exactly as the model boundary is scaffolded in
  `src/adapters/models/`. The core and app services depend on the interface,
  never on a vendor SDK. **No vendor SDK import exists outside its adapter
  directory** — swapping Twilio for another SMS provider, or S3 for another
  store, is a one-file change (mirrors 3.1 / the models-adapter rule).
- **Wiring:** the Phase E health check's probers (3.2, §6) are re-pointed
  from stubs to the real adapters; a failing real probe drives the same
  veto path 3 that already blocks entry to VERIFYING. The adapters are
  **dumb pipes** — they send/store/probe and report success or failure;
  they make no state decision (Preamble).
- **G1.1 — OPEN:** concrete vendor selection (which email/SMS/storage
  providers) and their credentials are a deployment decision, gated by the
  1.1 data-localization / cross-border check for vendors sitting abroad.
  The interface ships regardless of which vendor is chosen.

## G2. Envelope encryption — implement the shape that Phase C fixed — **DECIDED**

- **Decision:** Implement the `Payload` envelope (`src/domain/payload.ts`)
  as **KMS-wrapped per-item data keys** (8.1): each content item is
  encrypted with a fresh symmetric **data key** using **authenticated
  encryption (AES-256-GCM)**; the data key is wrapped by a **company KMS
  master key**; only the ciphertext and the wrapped key are stored.
  **Plaintext is never persisted and never logged** (there is no plaintext
  field, 9.1).
- **Designed for the deferred Shamir path (8.1, §8):** the wrap step is a
  seam — the wrapping authority is an interface, so trustee key-splitting
  can replace the single KMS wrap **without a data migration** (the stored
  envelope shape does not change; only who can unwrap does). This is the
  explicit V1 requirement from 8.1 kept honest in the implementation.
- **Key custody:** company-held server-side (8.1); the accepted residual
  risk (insider/server compromise) and its mitigations — encryption at
  rest, access logging, admin-revocable access — are unchanged from 8.1.
  The recipient page (F4) decrypts **per view, server-side**, and logs the
  access (metadata only).
- **G2.1 — OPEN:** the KMS provider and master-key rotation cadence are
  deployment config (rotation must be possible without re-encrypting
  content — envelope re-wrap only). Not a V1 blocker; the interface assumes
  rotation is possible.

## G3. Auth, operator identity, and manual recovery — **DECIDED**

Implements the F3 seam and the security decisions already in `DECISIONS.md`.

- **User login:** standard authenticated session for the app. **No
  automated self-serve password reset** (8.2) — this is the deliberate,
  spec-mandated absence: an automated reset is an automated path an attacker
  could use to seize an account and force a release. Recovery is manual
  (below).
- **Operator & admin login:** authenticated, **every action attributed and
  audit-logged** (invariant 7, 7.3). The operator identity recorded on a
  confirmation (4.1, 10.1) comes from this login, not a free-text field.
- **Manual audited account recovery (8.2):** admin-only, identity verified
  manually, every step logged (invariant 7). Slow by design; there is no
  code path that shortcuts it.
- **Admin freeze (veto path 4):** an audited manual action that halts a
  running process. It is fail-*safe* (toward delay) and therefore needs no
  HOLD-style window; unfreezing is equally audited.
- **Fail-safe default (from F3):** endpoints with no auth policy are denied.
  A sole operator being unavailable never causes a release — every admin
  gate and STALLED fail toward delay (invariant 5, 7.3).

## G4. Secret and key management — **DECIDED**

- **Decision:** The cancel-token HMAC secret (`src/cancel/token.ts`), the
  KMS master key (G2), session-signing keys (G3), and vendor credentials
  (G1) are supplied from a **secrets manager / environment injection**,
  **never committed, never logged, never placed in the audit trail** (5.3,
  invariant 6). Compromise of the cancel secret only lets an attacker forge
  a *cancel* (the safe direction, by the token model in F1) — but it is
  still rotated on the standard cadence. Compromise of the KMS key is the
  serious case and is mitigated by KMS custody boundaries and access logging
  (8.1).
- **Rotation:** the cancel secret supports **overlapping validity** (verify
  against current + previous) so rotation never invalidates a link a living
  user is about to click — invariant 1 must survive a key rotation.

## G5. Content size limits arrive as deployment policy — **DECIDED (values OPEN)**

- **Decision:** Per-kind byte limits (note / photo / pdf) are supplied as a
  `ContentPolicy` value at deployment and enforced at the app-service edge
  (F6) and in the schema, **never invented in the domain** (9.1, 11.5). G is
  where storage becomes real, so the policy must be set before storage
  ships — but the numbers remain a deployment decision, recorded **OPEN**
  exactly as in 11.5.

## G6. The security review is a Phase-G gate, not an afterthought — **DECIDED**

- **Decision:** Before Phase G is called done, run a security review of the
  new network + crypto + auth surface against the threat model
  (PRODUCT_SPEC §1): false positive, partial release, operator/trustee
  collusion, dependency rot, and now the added network attack surface. The
  review specifically re-checks that **no surface writes state** (Preamble),
  that **no channel leaks content/URL/code** (invariant 6) across the new
  HTTP paths, and that the **cancel path fails safe end-to-end** (F1/F5).

---

## Still open after Phases F & G

Carried forward; none blocks starting the phases, each gates a specific
piece:

- **F1.5** — cancel-surface deployment topology (separate process/host).
  Ops, before pilot launch.
- **F4.1** — recipient-access attempt cap / re-issue throttle
  (`RecipientAccessPolicy`). Deployment config.
- **F6 / 11.6** — minors / legal-capacity rule. Gate placement decided;
  rule pending counsel.
- **G1.1** — vendor selection + credentials, gated by the 1.1
  data-localization check for abroad vendors.
- **G2.1** — KMS provider + master-key rotation cadence. Deployment config.
- **G5 / 11.5** — content size limits (`ContentPolicy`). Deployment config.
- **2.3 / 11.2** — automated dormancy/lapse policy. Still deferred to
  post-pilot; intersects billing, not F/G directly.

---

## Safe to build against now (Phases F & G)

- **Layering (F0):** pure core → application services (the only mutating
  tier) → thin HTTP transport. No surface and no adapter writes state; every
  endpoint maps to a `transition` event or console action (Preamble).
- **Cancel first, isolated, fail-safe (F1):** `GET` renders, `POST`
  cancels; token-as-capability so no CSRF handshake; bad/missing token
  always shows the fallback; idempotent; observable SLO; own failure domain.
- **Four audiences over the machine (F2):** user app can only move toward
  ACTIVE or edit unfrozen content; console records confirmations and calls
  the still-guarded start-HOLD; recipient page is read-only; admin freeze is
  fail-safe.
- **Auth as a seam in F, implemented in G (F3/G3):** every non-cancel,
  non-recipient endpoint has a logged principal; unpolicied endpoints deny;
  no automated account reset (8.2); manual audited recovery; audited freeze.
- **Recipient page (F4):** link-only email + separate-channel 72h
  re-issuable code, constant-time verify, attempt-capped, access logged and
  revocable, content rendered server-side per view.
- **Adapters behind ports (G1):** email/SMS/storage as dumb pipes; no SDK
  outside its adapter dir; real probers drive the existing veto path 3.
- **Envelope encryption (G2):** AES-256-GCM per-item data keys, KMS-wrapped,
  Shamir-ready without migration; company-held custody per 8.1; plaintext
  never stored or logged.
- **Secrets (G4):** injected, never committed/logged; cancel secret rotates
  with overlapping validity so invariant 1 survives rotation.
- **Policy values (G5/F4.1/F6):** size limits, access throttle, and the
  minors gate arrive as deployment config, never invented in the domain.
- **Security review gate (G6):** F/G is not done until the new surface is
  reviewed against the threat model and the invariants.
