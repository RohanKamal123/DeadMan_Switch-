// Resend email adapter (G1.1). Exercises send/probe/refreshProbe against an
// injected fake fetch — no network.

import { ResendEmailAdapter } from '../../src/adapters/channels/resend-email';

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

function fakeFetch(behavior: (call: Call) => { ok: boolean; status: number; text: string }) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = behavior({ url, init });
    return { ok: r.ok, status: r.status, text: async () => r.text };
  };
  return { fetchImpl, calls };
}

function adapter(behavior: (call: Call) => { ok: boolean; status: number; text: string }) {
  const { fetchImpl, calls } = fakeFetch(behavior);
  return {
    calls,
    email: new ResendEmailAdapter({ apiKey: 'key123', from: 'Legacy Vault <noreply@x.test>', fetchImpl }),
  };
}

// sendEmail is synchronous/fire-and-forget; tests await a microtask tick so the
// underlying promise settles before asserting on its effects.
function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('ResendEmailAdapter — send (fire-and-forget, sync interface)', () => {
  it('posts to /emails with the right shape and marks the probe healthy on success', async () => {
    const { email, calls } = adapter(() => ({ ok: true, status: 200, text: '{}' }));
    email.sendEmail('r@t.test', 'Subject', 'Body text');
    await tick();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.resend.com/emails');
    const body = JSON.parse(calls[0]!.init.body as string) as Record<string, unknown>;
    expect(body['to']).toEqual(['r@t.test']);
    expect(body['subject']).toBe('Subject');
    expect(body['text']).toBe('Body text');
    expect(body['from']).toBe('Legacy Vault <noreply@x.test>');
    expect(email.probe()).toBe(true);
  });

  it('never throws back at the synchronous caller when the send fails', async () => {
    const { email } = adapter(() => ({ ok: false, status: 401, text: 'invalid key' }));
    expect(() => email.sendEmail('r@t.test', 'S', 'B')).not.toThrow();
    await tick();
    expect(email.probe()).toBe(false);
  });
});

describe('ResendEmailAdapter — health probe (§6)', () => {
  it('defaults to unhealthy before any traffic', () => {
    const { email } = adapter(() => ({ ok: true, status: 200, text: '{}' }));
    expect(email.probe()).toBe(false);
  });

  it('refreshProbe checks the key/connectivity without sending mail', async () => {
    const { email, calls } = adapter(() => ({ ok: true, status: 200, text: '{}' }));
    await expect(email.refreshProbe()).resolves.toBe(true);
    expect(calls[0]!.url).toBe('https://api.resend.com/api-keys');
    expect(calls[0]!.init.method).toBe('GET');
  });

  it('refreshProbe reports unhealthy, never throws, when the backend is down', async () => {
    const email = new ResendEmailAdapter({
      apiKey: 'k',
      from: 'a@x.test',
      fetchImpl: async () => {
        throw new Error('network down');
      },
    });
    await expect(email.refreshProbe()).resolves.toBe(false);
  });
});
