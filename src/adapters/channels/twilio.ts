// Phase G — the Twilio SMS adapter (DECISIONS_PHASE_F_G.md G1 / G1.1).
//
// SMS is the security-critical SEPARATE CHANNEL that carries the recipient's
// one-time release code (invariant 6), so the chosen vendor is Twilio. This
// adapter is a DUMB PIPE (Preamble): it sends bytes and reports health; it makes
// no state decision. It speaks Twilio's public REST API directly over the shared
// HTTP transport — there is NO Twilio SDK, so nothing new enters the supply
// chain and swapping Twilio for another SMS vendor is a one-file change (G1).
//
// The `SmsPort` methods are synchronous (the health check and cadence senders
// call them synchronously), so a real network send is FIRE-AND-FORGET: `sendSms`
// dispatches the request in the background and returns immediately. A send that
// fails flips the cached health flag, so the next weekly probe reports the
// outage and drives veto path 3 (§6) — an outage delays, it never releases.
//
// SECRETS: the account SID and auth token are injected (G4) and used only to
// build the HTTP Basic credential; they are never logged. `onError` receives a
// generic failure notice with NO secret, code, or message body.

import type { SmsPort } from './ports';
import { InFlight, isOk, nodeHttpTransport, type HttpTransport } from './http-transport';

export interface TwilioSmsConfig {
  readonly accountSid: string;
  readonly authToken: string;
  /** The Twilio sender: an E.164 number or a Messaging Service SID (MG...). */
  readonly from: string;
  /** API root; defaults to https://api.twilio.com. Override for a regional edge or a test. */
  readonly baseUrl?: string;
  /** Injectable for tests; defaults to the real Node http/https transport. */
  readonly transport?: HttpTransport;
  /** Observability hook. Receives NO secret, code, or message body. */
  readonly onError?: (detail: string) => void;
}

const DEFAULT_BASE_URL = 'https://api.twilio.com';

export class TwilioSmsAdapter implements SmsPort {
  private readonly accountSid: string;
  private readonly from: string;
  private readonly baseUrl: string;
  private readonly transport: HttpTransport;
  private readonly onError: ((detail: string) => void) | undefined;
  private readonly authHeader: string;
  private readonly inflight = new InFlight();

  /** Optimistic until a real send or probe says otherwise — matches the in-memory port's default. */
  private healthy = true;

  constructor(config: TwilioSmsConfig) {
    if (config.accountSid === '' || config.authToken === '' || config.from === '') {
      throw new Error('TwilioSmsAdapter requires accountSid, authToken, and from');
    }
    this.accountSid = config.accountSid;
    this.from = config.from;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.transport = config.transport ?? nodeHttpTransport;
    this.onError = config.onError;
    this.authHeader = `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64')}`;
  }

  /** Fire-and-forget: dispatch the SMS and return. Health reflects the outcome. */
  sendSms(to: string, body: string): void {
    void this.inflight.track(this.post(to, body));
  }

  private async post(to: string, body: string): Promise<void> {
    const url = `${this.baseUrl}/2010-04-01/Accounts/${encodeURIComponent(this.accountSid)}/Messages.json`;
    const form = new URLSearchParams({ To: to, From: this.from, Body: body }).toString();
    try {
      const res = await this.transport({
        method: 'POST',
        url,
        headers: { authorization: this.authHeader, 'content-type': 'application/x-www-form-urlencoded' },
        body: form,
      });
      this.setHealthy(isOk(res.status), `send returned ${res.status}`);
    } catch {
      this.setHealthy(false, 'send failed');
    }
  }

  /**
   * Returns the cached health and kicks off a background refresh. The value is a
   * real signal (last send/probe outcome), never a stub; the first probe after a
   * boot may be optimistic until the refresh resolves — call `checkHealth()` at
   * startup to seed it.
   */
  probe(): boolean {
    void this.inflight.track(this.checkHealth());
    return this.healthy;
  }

  /** A real deliverability self-test: fetch the account resource with the credential. */
  async checkHealth(): Promise<boolean> {
    const url = `${this.baseUrl}/2010-04-01/Accounts/${encodeURIComponent(this.accountSid)}.json`;
    try {
      const res = await this.transport({ method: 'GET', url, headers: { authorization: this.authHeader } });
      this.setHealthy(isOk(res.status), `probe returned ${res.status}`);
    } catch {
      this.setHealthy(false, 'probe failed');
    }
    return this.healthy;
  }

  /** Wait for in-flight sends/probes to settle (tests, graceful shutdown). */
  drain(): Promise<void> {
    return this.inflight.drain();
  }

  private setHealthy(ok: boolean, detail: string): void {
    this.healthy = ok;
    if (!ok) this.onError?.(`twilio: ${detail}`);
  }
}
