// Resend email adapter (G1.1) — the ONLY place a Resend API detail lives,
// mirroring the Stripe adapter: plain `fetch` over Resend's REST API, no SDK,
// so nothing vendor-shaped escapes this file (G1; CLAUDE.md's models-adapter
// rule, mirrored for every vendor).
//
//   LV_EMAIL_PROVIDER=resend
//   LV_RESEND_API_KEY=re_...
//   LV_RESEND_FROM_EMAIL="Legacy Vault <noreply@yourdomain.com>"
//
// EmailPort.sendEmail is a SYNCHRONOUS, void-returning call (every existing
// caller — the scheduler's reminder cadence, the delivery dispatcher, drills —
// is synchronous and has no way to await a result). A real send is a network
// call, so this fires it and does NOT block the caller: failures are caught
// here, logged, and reflected in the cached health probe — never thrown back
// at a synchronous caller. This is the same fire-and-forget-with-an-internal-
// health-cache shape as R2StorageAdapter (see r2-storage.ts's file header for
// the fuller rationale) and the same reason PostgresKeyValueStore queues writes.
//
// HONEST GAP: `probe()`/`refreshProbe()` verify the API key and connectivity
// (a lightweight authenticated GET), not actual inbox deliverability. The spec
// (§6) describes sending a real test email to a company-owned address and
// verifying it lands — full deliverability verification needs a receiving
// inbox or Resend's delivery webhooks wired up, which is a real follow-up, not
// done here. What's built still catches the common failure modes: an expired
// key, a revoked API token, Resend being unreachable.

import type { EmailPort } from './ports';

type FetchLike = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface ResendEmailAdapterOptions {
  readonly apiKey: string;
  /** e.g. "Legacy Vault <noreply@yourdomain.com>" — must be a domain verified in Resend. */
  readonly from: string;
  readonly apiBase?: string;
  readonly fetchImpl?: FetchLike;
}

export class ResendEmailAdapter implements EmailPort {
  private readonly apiKey: string;
  private readonly from: string;
  private readonly apiBase: string;
  private readonly fetchImpl: FetchLike;
  /** Cached last-known-good health. Defaults unhealthy — unknown never reads as healthy. */
  private lastProbeOk = false;

  constructor(options: ResendEmailAdapterOptions) {
    this.apiKey = options.apiKey;
    this.from = options.from;
    this.apiBase = options.apiBase ?? 'https://api.resend.com';
    this.fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  }

  sendEmail(to: string, subject: string, body: string): void {
    void this.send(to, subject, body).catch((error: unknown) => {
      this.lastProbeOk = false;
      // eslint-disable-next-line no-console
      console.error('[resend] send failed (the reminder/link was NOT delivered):', error);
    });
  }

  private async send(to: string, subject: string, body: string): Promise<void> {
    const res = await this.fetchImpl(`${this.apiBase}/emails`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: this.from, to: [to], subject, text: body }),
    });
    if (!res.ok) {
      throw new Error(`resend send failed (${res.status}): ${await res.text()}`);
    }
    this.lastProbeOk = true;
  }

  /** Synchronous health read (§6). Cached — see file header. */
  probe(): boolean {
    return this.lastProbeOk;
  }

  /** A lightweight authenticated call, proving the key/connectivity work. Never throws. */
  async refreshProbe(): Promise<boolean> {
    try {
      const res = await this.fetchImpl(`${this.apiBase}/api-keys`, {
        method: 'GET',
        headers: { authorization: `Bearer ${this.apiKey}` },
      });
      this.lastProbeOk = res.ok;
    } catch {
      this.lastProbeOk = false;
    }
    return this.lastProbeOk;
  }
}
