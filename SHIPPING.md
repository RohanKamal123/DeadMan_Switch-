# Shipping Legacy Vault to Render — Step by Step

A plain, in-order walkthrough to get the real infrastructure live: Postgres,
Cloudflare R2, the KMS key, the isolated cancel surface, the background worker.
Follow it top to bottom — each step assumes the one before it is done.

## Before you start — what this gets you, honestly

**Built, tested, and wired today:** the state machine, all four surfaces (user
app, cancel link, operator console, recipient page), Postgres persistence,
envelope encryption, Cloudflare R2 content storage, the decrypt-and-serve
recipient page, the background worker, graceful shutdown, Stripe billing
(test mode until you add real keys), the legal pages.

**Not built yet: real email and SMS.** `LV_EMAIL_PROVIDER` and
`LV_SMS_PROVIDER` still default to the in-memory dev sink — nothing actually
sends. That means NUDGE reminders and, more importantly, the **HOLD
cancel-prompts** (the product's single most important safety feature) will
not reach anyone yet.

**So: this guide gets you a real, working deployment you and trusted testers
can click through end to end. Do not invite anyone who isn't watching the app
directly (not relying on an email/SMS reminder) until email + SMS are wired.**
Ask me for that next — it's the same one-file-adapter pattern as R2.

---

## Step 1 — Generate your three secrets

Run these locally and save the output somewhere safe (a password manager) —
never in a file you commit:

```bash
echo "LV_CANCEL_SECRET=$(openssl rand -hex 32)"
echo "LV_SESSION_SECRET=$(openssl rand -hex 32)"
echo "LV_KMS_MASTER_KEY=$(openssl rand -hex 32)"
```

`LV_KMS_MASTER_KEY` must be exactly 64 hex characters (32 bytes) — the command
above always produces that. This key encrypts every piece of content ever
stored; losing it means losing access to everything. Keep the saved copy safe.

## Step 2 — Gather your R2 details

You said R2 is already set up. You need four values from the Cloudflare
dashboard:

| Value | Where to find it |
|---|---|
| Account ID | R2 → Overview page, right sidebar |
| Access Key ID + Secret Access Key | R2 → Manage API Tokens → Create API Token → **Object Read & Write**, scoped to your bucket |
| Bucket name | R2 → the bucket you created |

## Step 3 — Create a Postgres database on Render

Two Render services will share this one database (the main app, and the
isolated cancel surface — Step 5).

1. Render dashboard → **New +** → **PostgreSQL**
2. Name it (e.g. `legacy-vault-db`), pick a region, choose a plan
   (Render's free Postgres expires after 30 days — fine for testing now, plan
   to upgrade to a paid plan before anything you care about keeping)
3. Create it, then copy the **Internal Database URL** shown on its page (use
   Internal, not External — it's faster and free between Render services in
   the same region)

## Step 4 — Create the main web service

1. Render dashboard → **New +** → **Web Service** → connect this GitHub repo
   → pick the branch you want to deploy
2. **Build command:** `npm ci && npm run build`
3. **Start command:** `npm start`
4. **Instance type:** Free is fine to start
5. Under **Environment**, add these variables:

```
LV_SERVER_ROLE=api
LV_PORT=10000

LV_STATE_BACKEND=postgres
LV_DATABASE_URL=<the Internal Database URL from Step 3>

LV_CANCEL_SECRET=<from Step 1>
LV_SESSION_SECRET=<from Step 1>
LV_KMS_MASTER_KEY=<from Step 1>

LV_STORAGE_PROVIDER=r2
LV_R2_ACCOUNT_ID=<from Step 2>
LV_R2_ACCESS_KEY_ID=<from Step 2>
LV_R2_SECRET_ACCESS_KEY=<from Step 2>
LV_R2_BUCKET=<from Step 2>
LV_VENDOR_DATA_REGION=us
LV_VENDOR_CROSS_BORDER_ACK=1

LV_BASE_URL=https://<your-service-name>.onrender.com
LV_SUPPORT_URL=mailto:you@example.com
```

Notes on a couple of these:
- `LV_PORT=10000` — Render expects your app to listen on a known port; if
  Render's dashboard has a separate "Port" field, set it to `10000` too so
  they agree.
- `LV_VENDOR_DATA_REGION=us` + `LV_VENDOR_CROSS_BORDER_ACK=1` — R2 has no
  Bangladesh region (the product's launch jurisdiction, per `DECISIONS.md`
  1.1), so selecting any real vendor storage requires this explicit
  acknowledgement. Use whichever region your R2 bucket is actually in.
- `LV_BASE_URL` — you won't know the exact `.onrender.com` URL until after
  the first deploy. Deploy once, see the assigned URL, come back and set this
  correctly, then it'll redeploy automatically.

6. Click **Create Web Service** and let it deploy.

## Step 5 — Create the isolated cancel service

The cancel link is the product's highest-priority safety surface, and it's
designed to run in its own process so nothing else failing can take it down.
This is not optional before real users — the cancel link needs to actually
work.

1. Render dashboard → **New +** → **Web Service** → same repo, same branch
2. Name it something like `legacy-vault-cancel`
3. **Build command:** `npm ci && npm run build`
4. **Start command:** `npm start`
5. Environment variables — much shorter list, by design (F1.4/F1.5: the
   cancel process depends on nothing but the state store and its own secret):

```
LV_SERVER_ROLE=cancel
LV_CANCEL_PORT=10000

LV_STATE_BACKEND=postgres
LV_DATABASE_URL=<the SAME Internal Database URL from Step 3>

LV_CANCEL_SECRET=<the SAME value as the main service, from Step 1>

LV_SUPPORT_URL=mailto:you@example.com
LV_BASE_URL=<the main service's URL, from Step 4>
```

`LV_CANCEL_SECRET` must be **identical** on both services — it's how the
cancel service verifies a token the main service issued.

6. Create it and let it deploy.

## Step 6 — Watch the logs

On the **main** service, a healthy startup looks like:

```
[bootstrap] Storage provider: Cloudflare R2 — real content ciphertext is offloaded (G2/G1.1).
[bootstrap] EMAIL channel is the in-memory dev sink — no real email is sent (G1.1).
[bootstrap] SMS channel is the in-memory dev sink — no real sms is sent (G1.1).
[bootstrap] PUSH channel is the in-memory dev sink — no real push is sent (G1.1).
[legacy-vault] worker started (tick every 60000ms)
[legacy-vault] storage health probe refresh started (network-backed adapter detected)
[legacy-vault] web server on :10000
[legacy-vault] cancel server NOT started here (LV_SERVER_ROLE=api) — run a separate LV_SERVER_ROLE=cancel process.
```

The EMAIL/SMS/PUSH warnings are expected right now (Step 0). On the
**cancel** service:

```
[legacy-vault] cancel server on :10000 (isolated failure domain, LV_SERVER_ROLE=cancel)
```

If either service's logs show a thrown error instead and it exits, it's
almost always a missing or misspelled environment variable — the error
message names exactly which one.

## Step 7 — Smoke test

Visit your main service's URL (`https://<your-service-name>.onrender.com`):

- [ ] The homepage loads
- [ ] `/legal/terms`, `/legal/privacy`, etc. load
- [ ] `/signup` lets you create an account, and `/app` shows your home screen
- [ ] The check-in button works
- [ ] `/console` (operator console) loads (you'll need an operator credential —
      ask me if you want a seed script for this)

On the cancel service's URL:

- [ ] `https://<cancel-service>.onrender.com/cancel?t=garbage` shows the
      fail-safe support page (a bad token should never dead-end — this is
      invariant 1's UI-uptime property, and it's the one thing this surface
      must always do even with nothing else configured right)

If all of that works, the real infrastructure is live and correctly wired.

## Step 8 — What's still blocking a real pilot

Not code problems — decisions and the last integrations:

- **Real email + SMS adapters.** Same pattern as R2: a one-file adapter
  behind the existing port. Tell me which providers (e.g. Twilio for SMS,
  Postmark/SES for email) and I'll wire them the same way.
- **Legal review.** The `/legal/*` pages are honest, human-written drafts —
  they say so themselves. They need an actual lawyer's sign-off for your
  jurisdiction before anyone relies on them.
- **The operator team and their runbook.** Verification in this product is
  manual, by design (no AI, no automated calling) — someone has to actually
  do it. Write down who, and how they use the console.
- **Stripe live keys**, when you're ready to charge — until then it silently
  runs in test mode (`LV_STRIPE_SECRET_KEY` unset).

---

## Quick reference: rotating a secret

If a secret ever leaks: `LV_CANCEL_SECRET` supports overlapping rotation —
set the old value in `LV_CANCEL_SECRET_PREVIOUS` (comma-separated for more
than one) on **both** services when you rotate `LV_CANCEL_SECRET`, so a link
already in someone's inbox keeps working through the transition.
`LV_SESSION_SECRET` and `LV_KMS_MASTER_KEY` don't have this rotation
mechanism yet — rotating `LV_KMS_MASTER_KEY` specifically requires re-wrapping
every stored data key, not just swapping the value (ask before doing this).
