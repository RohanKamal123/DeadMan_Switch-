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

### Server role — cancel-surface topology (`LV_SERVER_ROLE`)

The single process runs both servers by default. To give the cancel surface true
failure-domain isolation (F1.4/F1.5), split it into its own process/host:

| Value | Runs | Notes |
|---|---|---|
| `combined` | web + cancel | default; dev / single-node |
| `api` | web only | pair with a separate `cancel` process |
| `cancel` | cancel only | **isolated**: boots on the state store + `LV_CANCEL_SECRET` alone — no KMS, vendor, or billing dependency, so nothing else failing can take the cancel link down |

The code seam was always present; this makes the deployment split a one-variable
choice.

### The worker — the death-path clock

The `combined` and `api` processes also start the **Phase-E worker**, the clock
that advances the machine over time: NUDGE reminders, the day-30 move to
VERIFYING, HOLD cancel-prompts, the HOLD→PRIVATE_RELEASE / PRIVATE→PUBLIC
transitions, and the weekly dependency health check. Without it nothing advances.
It can never release early (the guards forbid it); a slow or missed tick only
ever *delays* — the cheap, safe direction — because each tick re-derives due work
from persisted state and catches up.

| Variable | Default | Effect |
|---|---|---|
| `LV_RUN_WORKER` | `1` | Run the worker in this process. Set `0` to run it elsewhere — but it must run in **exactly one** process (V1 is single-node; DECISIONS.md 7.1). |
| `LV_WORKER_INTERVAL_MS` | `60000` | How often due work is checked. Purely an operational poll cadence, not a domain timer; all domain deadlines are day-granular, so any sub-day value is safe. |

Private-release *delivery* (the gated email/SMS) stays operator-triggered by
design (PRODUCT_SPEC.md §PRIVATE_RELEASE) and is not driven by the worker.

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

## Vendor & KMS selection (bootstrap)

`src/config/bootstrap.ts` is the single place a deployment chooses concrete
vendors, the KMS provider, and the policy numbers — all behind ports the rest of
the system already depends on. The governing rule: **a provider you name but that
is not wired fails the boot; it never silently falls back to a dev stand-in.** An
operator must never believe SMS is live, or content is KMS-wrapped, while it is
running on the in-memory adapter or the local key.

| Variable | Default | Effect |
|---|---|---|
| `LV_KMS_PROVIDER` | `local` | KMS wrapper for envelope encryption (G2/G2.1). `local` uses `LV_KMS_MASTER_KEY`; a named managed KMS needs its adapter wired or the boot fails. |
| `LV_KMS_KEY_ID` | `kms-primary` | Wrapping-key id stored in the envelope; rotation is a new id + key, no content re-encryption. |
| `LV_EMAIL_PROVIDER` / `LV_SMS_PROVIDER` / `LV_PUSH_PROVIDER` | `memory` | Channel vendors (G1.1). `memory` is the dev sink (warned on startup); a real provider needs its adapter wired. |
| `LV_STORAGE_PROVIDER` | `memory` | `memory` is the dev sink; `r2` wires real **Cloudflare R2** content storage — see below. |
| `LV_VENDOR_DATA_REGION` | — | Required when any real vendor is selected — where it stores data (DECISIONS.md 1.1). |
| `LV_VENDOR_CROSS_BORDER_ACK` | — | Must be truthy to select a vendor storing data outside the launch jurisdiction (Bangladesh). Cross-border data flow is a deliberate, recorded choice — R2 has no Bangladesh region, so selecting it needs this. |
| `LV_MAX_NOTE_BYTES` / `LV_MAX_PHOTO_BYTES` / `LV_MAX_PDF_BYTES` | 100 KB / 10 MB / 25 MB | Per-kind content size limits (G5/11.5). |
| `LV_RECIPIENT_CODE_ATTEMPT_CAP` | `5` | Gated-page one-time-code attempt cap (F4.1); the code locks and a re-issue is required after this many failures. `off` disables the cap. |

Real email / SMS vendors and a managed KMS adapter are still to be written —
those surfaces run on the in-memory dev adapters / local key, and the bootstrap
warns so on startup. Each is a one-file adapter behind the existing port,
selected by the variables above; wiring one does not touch the death path.
Storage (R2) is wired — see below.

## Content storage: Cloudflare R2, and decrypt-and-serve (G2)

```
LV_STORAGE_PROVIDER=r2
LV_R2_ACCOUNT_ID=...        LV_R2_ACCESS_KEY_ID=...
LV_R2_SECRET_ACCESS_KEY=... LV_R2_BUCKET=...
LV_VENDOR_DATA_REGION=us    LV_VENDOR_CROSS_BORDER_ACK=1   # R2 has no BD region
npm install @aws-sdk/client-s3   # R2 speaks the S3 API; lazy-required, install to use it
```

Real content ciphertext (a photo/PDF up to the configured size limit) is
offloaded out of the KV state store into R2, keyed by `accountId/payloadId`.
The KV store keeps only metadata (kind, mime type, key id, IV, addressing,
timestamps) plus a sentinel marking the record as blob-backed — the stored
envelope shape a reader sees is unchanged either way. `AuthoringService` writes
through on save (fire-and-forget on an internal durable queue, the same model
already used for the Postgres backend; `authoring.flush()` awaits it); an edit
that only changes metadata (e.g. re-addressing recipients) never re-touches the
blob, so it can't silently overwrite real content with a stale write.

The recipient gated page (`/release`) now genuinely decrypts and serves content
per view — this was the Phase-G2 gap the F4 design always called for
("content rendered server-side, streamed from decrypted storage per view") and
is now built for **every** deployment, not just R2 ones: `ReleaseService`
resolves ciphertext (from R2 when offloaded, inline otherwise), decrypts with
the configured KMS key, and returns it to the one response that unlocks it — a
note renders as plain text, a photo/PDF is embedded as a `download` link. Never
written to a URL, a cookie, or client storage; a payload that fails to decrypt
is skipped, not thrown, so one bad item never breaks the whole unlock.

Storage's weekly health probe (§6, veto path 3) can't make a real network call
synchronously, so `R2StorageAdapter.probe()` reads a **cached** last-known-good
result — refreshed by real read/write traffic, and defaulting to **unhealthy**
before any traffic exists. Unknown health blocking entry to VERIFYING is the
conservative direction the whole product is built around.
