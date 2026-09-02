// Twilio SMS adapter (G1.1). Exercises send/probe/refreshProbe against an
// injected fake fetch — no network.

import { TwilioSmsAdapter } from '../../src/adapters/channels/twilio-sms';

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
    sms: new TwilioSmsAdapter({ accountSid: 'AC123', authToken: 'tok123', fromNumber: '+15550001111', fetchImpl }),
  };
}

function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('TwilioSmsAdapter — send (fire-and-forget, sync interface)', () => {
  it('posts to the Messages endpoint with Basic auth and the right form fields', async () => {
    const { sms, calls } = adapter(() => ({ ok: true, status: 201, text: '{}' }));
    sms.sendSms('+15551234567', 'Your one-time code is 123456');
    await tick();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json');
    const auth = calls[0]!.init.headers as Record<string, string>;
    expect(auth['authorization']).toBe(`Basic ${Buffer.from('AC123:tok123').toString('base64')}`);
    const body = new URLSearchParams(calls[0]!.init.body as string);
    expect(body.get('To')).toBe('+15551234567');
    expect(body.get('From')).toBe('+15550001111');
    expect(body.get('Body')).toBe('Your one-time code is 123456');
    expect(sms.probe()).toBe(true);
  });

  it('never throws back at the synchronous caller when the send fails', async () => {
    const { sms } = adapter(() => ({ ok: false, status: 401, text: 'auth failed' }));
    expect(() => sms.sendSms('+1', 'code')).not.toThrow();
    await tick();
    expect(sms.probe()).toBe(false);
  });
});

describe('TwilioSmsAdapter — health probe (§6)', () => {
  it('defaults to unhealthy before any traffic', () => {
    const { sms } = adapter(() => ({ ok: true, status: 200, text: '{}' }));
    expect(sms.probe()).toBe(false);
  });

  it('refreshProbe checks credentials/connectivity without sending an SMS', async () => {
    const { sms, calls } = adapter(() => ({ ok: true, status: 200, text: '{}' }));
    await expect(sms.refreshProbe()).resolves.toBe(true);
    expect(calls[0]!.url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC123.json');
    expect(calls[0]!.init.method).toBe('GET');
  });

  it('refreshProbe reports unhealthy, never throws, when the backend is down', async () => {
    const sms = new TwilioSmsAdapter({
      accountSid: 'AC123',
      authToken: 't',
      fromNumber: '+1',
      fetchImpl: async () => {
        throw new Error('network down');
      },
    });
    await expect(sms.refreshProbe()).resolves.toBe(false);
  });
});
