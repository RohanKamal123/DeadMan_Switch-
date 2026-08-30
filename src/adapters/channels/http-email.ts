// Phase G — a generic HTTP email adapter (DECISIONS_PHASE_F_G.md G1 / G1.1).
//
// The user chose Twilio (SMS) and their own VPS (storage); no email vendor was
// named, so this adapter stays vendor-NEUTRAL: it POSTs a small JSON envelope to
// a configured HTTP endpoint (`{ to, subject, body }`) with an optional bearer
// token. That endpoint is deployment config — a self-hosted relay on the same
// VPS, or any provider's HTTP send API — so choosing email later is a config
// change, not a code change, and the 1.1 cross-border gate is decided by which
// endpoint is configured, not by this file. No SDK, so nothing new enters the
// supply chain (G1).
//
// The recipient gated EMAIL carries only a link, never content or a code
// (invariant 6); that separation is enforced upstream by the delivery engine,
// not here — this adapter is a dumb pipe that sends whatever bytes it is given.
//
// `EmailPort` is synchronous, so a send is FIRE-AND-FORGET; a failed send flips
// the cached health flag so the next weekly probe reports the outage (veto path
// 3, §6). Health is probed by a lightweight GET against a configured health path.

import type { EmailPort } from './ports';
import { InFlight, isOk, nodeHttpTransport, type HttpTransport } from './http-transport';

export interface HttpEmailConfig {
  /** Endpoint that accepts `POST { to, subject, body }` as JSON and sends the mail. */
  readonly sendUrl: string;
  /** Optional GET endpoint that returns 2xx when the mailer is healthy. Defaults to `sendUrl`. */
  readonly healthUrl?: string;
  /** Optional bearer token the endpoint requires (injected secret; never logged). */
  readonly authToken?: string;
  /** Injectable for tests; defaults to the real Node http/https transport. */
  readonly transport?: HttpTransport;
  /** Observability hook. Receives NO secret, subject, or body — only a status detail. */
  readonly onError?: (detail: string) => void;
}

export class HttpEmailAdapter implements EmailPort {
  private readonly sendUrl: string;
  private readonly healthUrl: string;
  private readonly transport: HttpTransport;
  private readonly onError: ((detail: string) => void) | undefined;
  private readonly headers: Record<string, string>;
  private readonly inflight = new InFlight();

  private healthy = true;

  constructor(config: HttpEmailConfig) {
    if (config.sendUrl === '') throw new Error('HttpEmailAdapter requires a sendUrl');
    this.sendUrl = config.sendUrl;
    this.healthUrl = config.healthUrl ?? config.sendUrl;
    this.transport = config.transport ?? nodeHttpTransport;
    this.onError = config.onError;
    this.headers = {
      'content-type': 'application/json',
      ...(config.authToken === undefined ? {} : { authorization: `Bearer ${config.authToken}` }),
    };
  }

  sendEmail(to: string, subject: string, body: string): void {
    void this.inflight.track(this.post(to, subject, body));
  }

  private async post(to: string, subject: string, body: string): Promise<void> {
    try {
      const res = await this.transport({
        method: 'POST',
        url: this.sendUrl,
        headers: this.headers,
        body: JSON.stringify({ to, subject, body }),
      });
      this.setHealthy(isOk(res.status), `send returned ${res.status}`);
    } catch {
      this.setHealthy(false, 'send failed');
    }
  }

  probe(): boolean {
    void this.inflight.track(this.checkHealth());
    return this.healthy;
  }

  async checkHealth(): Promise<boolean> {
    try {
      const res = await this.transport({ method: 'GET', url: this.healthUrl, headers: this.headers });
      this.setHealthy(isOk(res.status), `probe returned ${res.status}`);
    } catch {
      this.setHealthy(false, 'probe failed');
    }
    return this.healthy;
  }

  drain(): Promise<void> {
    return this.inflight.drain();
  }

  private setHealthy(ok: boolean, detail: string): void {
    this.healthy = ok;
    if (!ok) this.onError?.(`http-email: ${detail}`);
  }
}
