# Launch Readiness — Legacy Vault V1

What stands between the current codebase and a payable SaaS. The **engine is
done** — the guarded state machine, all seven invariants, the durable
hash-chained audit, the scheduler, the four HTTP surfaces, the real vendor
adapters, envelope crypto with master-key rotation (G2.1), scrypt-hashed
credentials, and 373 passing tests. Everything below is what surrounds that
engine and is **not** yet built or not yet decided.

Each item notes where the gap lives in the code or the decision log so it can be
verified, not taken on trust. Boxes are unchecked until the work is actually
done and merged.

> **The one rule still governs every item here.** A false positive (releasing
> while the user is alive) is catastrophic and irreversible; a false negative
> (releasing late) is cheap. Nothing on this list may be "shipped" in a way that
> weakens an invariant to move faster. — `CLAUDE.md`

---

## 1. Hard blockers — must build before launch

### 1.1 User-facing product (UI)
- [ ] **User web app** — sign-up/enrollment, author content, check-in, cancel,
      manage trustees/recipients.
- [ ] **Operator console UI** — V1 verification and outreach are performed
      **manually by operators** through this console; today only the JSON API
      exists.
- [ ] **Admin UI** — freeze/unfreeze (veto path 4), manual audited account
      recovery (8.2).
- [ ] **Recipient gated page** — a real rendered page over the F4 release flow
      (link + separate-channel code, attempt-capped, server-side decryption per
      view).
- *Gap:* the system exposes only JSON HTTP APIs for four audiences.
  `README.md`: *"there is no UI for the user/operator/admin JSON APIs."*

### 1.2 Public-release destination (§PUBLIC_RELEASE)
- [ ] Build and wire the real public-release publisher.
- [ ] Remove the in-memory stand-in and its start-up warning.
- *Gap:* `bootstrap.ts` wires `InMemoryPublicPublisher` and logs
  `WARNING: public-release publisher is an in-memory stand-in`. Public content
  currently goes nowhere.

### 1.3 Production persistence
- [ ] Replace file-backed JSON KV (`FileKeyValueStore`) with a real database
      (concurrent access, durability).
- [ ] Durable home + integrity monitoring for the hash-chained audit trail
      (invariant 7).
- [ ] Backup and restore procedure, tested with a real restore drill.
- [ ] HA / failover posture decided.
- *Gap:* `persistence/kv.ts` — single-process, single-node JSON files. Fine for
  a one-box pilot, not a SaaS.

### 1.4 Billing / subscriptions
- [ ] Subscription + payments integration (none exists in the codebase today).
- [ ] Automated billing-lifecycle policy (dunning, lapse handling) — deferred
      post-pilot per DECISIONS 2.3 / 11.2.
- *Invariant to preserve:* billing failure must **never** trigger or block a
  release. DECISIONS 2.1 already decouples them — keep it that way.

### 1.5 Legal layer
- [ ] Advisory guidance: will names trustees, grants executor authority over
      digital assets (`PRODUCT_SPEC.md §8` marks this **"Not deferred, must ship
      in V1"**; DECISIONS 1.2). Confirm the content is actually written.
- [ ] **Minors / legal-capacity rule (F6 / 11.6)** — gate placement decided,
      rule pending counsel. *Still untouched — needs the legal decision first.*

---

## 2. Deployment config & vendor selection (mechanism built, values open)

- [ ] **KMS provider** — move master-key custody to a real cloud/HSM-backed KMS
      (a cloud adapter implements the same `KeyWrapper` and drops into the
      composition root unchanged). Rotation mechanism is built (G2.1); provider
      and rotation cadence remain open.
- [ ] **Vendor credentials/endpoints** — Twilio SMS, own-VPS storage, HTTP email
      are wired behind ports; supply real credentials (G1.1). Complete the 1.1
      cross-border storage check.
- [ ] **Push channel** — still `InMemoryPushAdapter`; select a push vendor
      (one-line swap in `adapters/channels/vendors.ts`).
- [ ] **Content size limits (G5 / 11.5)** — set the per-kind `ContentPolicy`
      byte/MIME values in deployment config.
- [ ] **Recipient access policy (F4.1)** — set `maxCodeAttempts` / `maxReissues`
      numbers (mechanism built and enforced).
- [ ] **Cancel-surface topology (F1.5)** — deploy the cancel server on its own
      host / failure domain (it already runs as a separate port/process).
- [ ] Fill in `config.example.json` values for the real environment (ports,
      storage paths, ops email, gated base URL, cancel fallback links).

---

## 3. Security & compliance gates

- [ ] **Run the G6 security review** — a full review of the network + crypto +
      auth surface against the threat model (`PRODUCT_SPEC §1`) is a Phase-G
      gate, not optional. Re-confirm: no surface writes state; no channel leaks
      content/URL/code (invariant 6); the cancel path fails safe end-to-end.
- [ ] Independent penetration test of the recipient release flow (the gated
      link + code is the only thing between an attacker and a deceased user's
      private content).
- [ ] Secrets management in production: `LV_*` secrets injected from a secrets
      manager, never committed, never logged (G4). Verify in the real deploy.
- [ ] Data-protection / privacy review for storing posthumous personal content
      (retention, deletion on CANCELLED, cross-border storage).

---

## 4. Operational readiness

- [ ] **Operator team staffed** with written SOPs — V1 outreach and verification
      are **manual**; the console is a tool, not the team.
- [ ] On-call, alerting, and incident runbooks (especially: a stuck HOLD, a
      failing dependency driving veto path 3, a suspected false-positive path).
- [ ] Real observability — request metrics currently just `console.log` lines
      (`ConsoleRequestMetrics`); ship structured logs/metrics to a real sink
      **without** ever logging content, URLs, or codes.
- [ ] Backup/restore and audit-integrity monitoring wired into on-call (see 1.3).
- [ ] Rotation runbook exercised: rotate the KMS master key via the key ring and
      re-wrap stored envelopes with `EnvelopeCrypto.rewrap`, then retire the old
      key from `LV_KMS_MASTER_KEY_PREVIOUS`.

---

## Suggested sequencing

1. **Decide persistence early (1.3).** It is the most painful item to retrofit
   after data exists.
2. **Build the UI (1.1) and public-release destination (1.2)** — the largest
   code efforts and the ones that make the product real end-to-end.
3. **Don't let billing (1.4) and the legal layer (1.5) get forgotten** — they
   block launch but aren't in anyone's code path, so they slip.
4. **Close deployment config (§2), then gate on the security review (§3) and
   operational readiness (§4)** before flipping the switch.

_Traceability: `PRODUCT_SPEC.md` (invariants, out-of-scope), `DECISIONS.md` and
`DECISIONS_PHASE_F_G.md` (F/G open items), `README.md` (not-yet-production
notes), and the in-code stand-in markers referenced above._
