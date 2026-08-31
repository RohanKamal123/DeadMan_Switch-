# Legacy Vault — Launch & Deployment

This is the public-release layer built on top of the V1 core (`README.md`,
`PRODUCT_SPEC.md`, `DECISIONS.md`). It adds the **web UI for all four
audiences**, the **public-release destination**, **production persistence**,
**billing**, and the **legal layer** — each behind the same ports-and-adapters
seams the core already uses, so choosing a real backend is configuration, not a
rewrite.

Nothing here relaxes an invariant. Cancel is still one tap from every surface,
the console still cannot skip or shorten HOLD, billing never touches the death
path, and every user- and operator-facing string is a static, human-written
template.

## Run it

```
npm ci
npm run typecheck        # tsc --noEmit
npm test                 # jest — 364 tests
npm run build && npm start
```

Minimum environment to boot (dev):

```
LV_STATE_BACKEND=memory
LV_CANCEL_SECRET=<random>
LV_SESSION_SECRET=<random>
LV_KMS_MASTER_KEY=<64 hex chars = 32 bytes>
```

Two servers start: the **web server** (`LV_PORT`, default 8080) serving the
public site, legal, memorials, the user app, the operator console, and the JSON
API; and the isolated **cancel server** (`LV_CANCEL_PORT`, default 8081) — the
highest-SLO surface, in its own failure domain.

## The four audiences (UI)

The design system (`src/http/design/`) is one server-rendered, dependency-free,
no-JS-required visual language — warm paper, ink, hairline rules, one restrained
evergreen accent for the *safe* direction. It renders all four surfaces, which
never share a screen:

| Surface | Where | Auth |
|---|---|---|
| **User app** | `/app` (+ `/signup`, home/liveness, people, content, settings, plan) | session cookie |
| **Cancel link** | `/cancel` (separate server) | signed token, no login |
| **Operator console** | `/console` | operator session cookie |
| **Recipient page** | `/release` | gated link + one-time code |

Public marketing (`/`, `/how-it-works`, `/who-its-for`, `/pricing`,
`/security`) and legal (`/legal/*`) round out the public surface.

## Persistence (`LV_STATE_BACKEND`)

The repositories speak one synchronous `KeyValueStore` contract, so the backend
is a swap:

| Value | Backend | Notes |
|---|---|---|
| `memory` | in-process | tests / dev only |
| `file` | single JSON file (`LV_STATE_FILE`) | pilot scale (DECISIONS.md 7.1) |
| `sqlite` | better-sqlite3 (`LV_SQLITE_PATH`) | **recommended single-node**: per-write durable |
| `postgres` | `pg` pool (`LV_DATABASE_URL`) | multi-node; write-through cache, `await flush()` on shutdown |

`sqlite` and `postgres` bindings are lazy-required — install only what you use:

```
npm install better-sqlite3        # for LV_STATE_BACKEND=sqlite
npm install pg                    # for LV_STATE_BACKEND=postgres
```

## Public-release destination

Public release (opt-in, 14 days after private release — the machine enforces
both) publishes a quiet, dignified **memorial document** to a durable store,
served at `/memorial/:handle`. The handle is an opaque digest, never the account
id. The publisher (`MemorialPublisher`) is a dumb pipe behind the existing
`PublicPublisher` port; a deployment supplies the `PublicContentSource` that
decides which content is public.

## Billing (Stripe, test-mode ready)

`src/billing/` is provider-agnostic: plans, entitlements, subscription state, and
gating. The **one rule**: *billing never changes the death path.* Entitlements
gate only new set-up actions (adding a recipient, enabling public release); a
lapse or downgrade never deletes content or alters a configured release.

Until Stripe keys are set, an in-process fake gateway runs (test mode). To go
live, set:

```
LV_STRIPE_SECRET_KEY=sk_...
LV_STRIPE_WEBHOOK_SECRET=whsec_...
LV_STRIPE_PRICE_PERSONAL=price_...
LV_STRIPE_PRICE_VAULT=price_...
```

Point the Stripe webhook at `POST /billing/webhook`. Signatures are verified with
Stripe's documented HMAC scheme (timing-safe, with a replay tolerance); a bad
signature is rejected (400) and nothing mutates.

## Legal layer

Human-written, plain-language documents at `/legal/*`: Terms, Privacy, a Data
Processing Addendum, Cookie Policy, the **wills & trustees estate advisory** the
spec insists must ship, and the sub-processor list. They are honest about the V1
residual risk (the company holds the keys). Launch jurisdiction: Bangladesh
(DECISIONS.md 1.1). None of it is legal advice.

## What is still an open item

Real email / SMS / storage vendors (G1.1) are not wired — those surfaces run on
the in-memory dev adapters, and the bootstrap says so on startup. Wiring a vendor
is a one-file adapter behind the existing channel ports.
