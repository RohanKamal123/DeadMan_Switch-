// Twilio SMS adapter (G1.1) — the ONLY place a Twilio API detail lives, mirroring
// the Stripe/Resend adapters: plain `fetch` over Twilio's REST API, no SDK, so
// nothing vendor-shaped escapes this file (G1).
//
//   LV_SMS_PROVIDER=twilio
//   LV_TWILIO_ACCOUNT_SID=AC...
//   LV_TWILIO_AUTH_TOKEN=...
//   LV_TWILIO_FROM_NUMBER=+1...
//
// Same shape as the Resend adapter (see resend-email.ts's file header for the
// fuller rationale): SmsPort.sendSms is a synchronous, void-returning call, so a
// real send fires and does not block the caller — failures are caught, logged,
// and reflected in the cached health probe, never thrown at a synchronous
// caller. This carries the one-time release CODE (delivery/release.ts) as well
// as cadence reminders and HOLD cancel-prompts, so a silent send failure here is
// exactly the "dependency rot" failure mode the threat model calls out — the
// weekly health probe (§6) is what catches it, not the caller.
//
// HONEST GAP: `probe()`/`refreshProbe()` verify the account SID/auth token and
// connectivity (a lightweight authenticated GET), not actual SMS delivery to a
// handset. Full deliverability verification (§6: "a real test SMS... verify
// actual deliverability") needs polling Twilio's per-message delivery status
// after a real send to a company-owned number — a real follow-up, not done here.

import type { SmsPort } from './ports';

type FetchLike = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface TwilioSmsAdapterOptions {
  readonly accountSid: string;
  readonly authToken: string;
  /** E.164 format, e.g. "+15551234567". */
  readonly fromNumber: string;
  readonly apiBase?: string;
  readonly fetchImpl?: FetchLike;
}

export class TwilioSmsAdapter implements SmsPort {
  private readonly accountSid: string;
  private readonly authToken: string;
  private readonly fromNumber: string;
  private readonly apiBase: string;
  private readonly fetchImpl: FetchLike;
  /** Cached last-known-good health. Defaults unhealthy — unknown never reads as healthy. */
  private lastProbeOk = false;

  constructor(options: TwilioSmsAdapterOptions) {
    this.accountSid = options.accountSid;
    this.authToken = options.authToken;
    this.fromNumber = options.fromNumber;
    this.apiBase = options.apiBase ?? 'https://api.twilio.com';
    this.fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  }

  private authHeader(): string {
    return `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64')}`;
  }

  sendSms(to: string, body: string): void {
    void this.send(to, body).catch((error: unknown) => {
      this.lastProbeOk = false;
      // eslint-disable-next-line no-console
      console.error('[twilio] send failed (the code/reminder was NOT delivered):', error);
    });
  }

  private async send(to: string, body: string): Promise<void> {
    const res = await this.fetchImpl(`${this.apiBase}/2010-04-01/Accounts/${this.accountSid}/Messages.json`, {
      method: 'POST',
      headers: { authorization: this.authHeader(), 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: to, From: this.fromNumber, Body: body }).toString(),
    });
    if (!res.ok) {
      throw new Error(`twilio send failed (${res.status}): ${await res.text()}`);
    }
    this.lastProbeOk = true;
  }

  /** Synchronous health read (§6). Cached — see file header. */
  probe(): boolean {
    return this.lastProbeOk;
  }

  /** A lightweight authenticated call, proving the credentials/connectivity work. Never throws. */
  async refreshProbe(): Promise<boolean> {
    try {
      const res = await this.fetchImpl(`${this.apiBase}/2010-04-01/Accounts/${this.accountSid}.json`, {
        method: 'GET',
        headers: { authorization: this.authHeader() },
      });
      this.lastProbeOk = res.ok;
    } catch {
      this.lastProbeOk = false;
    }
    return this.lastProbeOk;
  }
}
