// Phase G — real vendor adapters behind the ports (DECISIONS_PHASE_F_G.md
// G1 / G1.1): Twilio SMS, the operator's own VPS storage, and vendor-neutral
// HTTP email. Each is a dumb pipe over the injectable HTTP transport (no SDK):
// it sends/stores bytes and reports a REAL health signal that drives veto path 3.
// These tests drive the adapters against a fake transport — no network.

import {
  HttpEmailAdapter,
  TwilioSmsAdapter,
  VpsStorageAdapter,
  createVendorChannels,
  vendorConfigFromEnv,
  type HttpTransport,
  type HttpTransportRequest,
  type HttpTransportResponse,
} from '../../src/adapters/channels';

/** A fake transport: records every request and answers via a handler. */
function fakeTransport(handler: (req: HttpTransportRequest) => HttpTransportResponse) {
  const requests: HttpTransportRequest[] = [];
  const transport: HttpTransport = (req) => {
    requests.push(req);
    return Promise.resolve(handler(req));
  };
  return { transport, requests };
}

const ok = (body = ''): HttpTransportResponse => ({ status: 200, body });

describe('TwilioSmsAdapter (G1.1 — the security-critical SMS channel)', () => {
  const base = { accountSid: 'AC123', authToken: 'tok', from: '+8801000' };

  it('POSTs the message to Twilio with Basic auth and a form body', async () => {
    const fake = fakeTransport(() => ({ status: 201, body: '{}' }));
    const sms = new TwilioSmsAdapter({ ...base, transport: fake.transport });
    sms.sendSms('+8801999', 'Your one-time code is 482913');
    await sms.drain();

    expect(fake.requests).toHaveLength(1);
    const req = fake.requests[0]!;
    expect(req.method).toBe('POST');
    expect(req.url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json');
    expect(req.headers?.['authorization']).toBe(`Basic ${Buffer.from('AC123:tok').toString('base64')}`);
    const form = new URLSearchParams(req.body);
    expect(form.get('To')).toBe('+8801999');
    expect(form.get('From')).toBe('+8801000');
    expect(form.get('Body')).toBe('Your one-time code is 482913');
    expect(sms.probe()).toBe(true);
  });

  it('a failed send flips health, which drives veto path 3 on the next probe', async () => {
    let details: string[] = [];
    const fake = fakeTransport(() => ({ status: 500, body: 'boom' }));
    const sms = new TwilioSmsAdapter({ ...base, transport: fake.transport, onError: (d) => details.push(d) });
    sms.sendSms('+8801999', 'code');
    await sms.drain();
    expect(sms.probe()).toBe(false);
    expect(details.join(' ')).toContain('twilio');
    // The failure detail carries no secret or message body.
    expect(details.join(' ')).not.toContain('tok');
    expect(details.join(' ')).not.toContain('code');
  });

  it('checkHealth fetches the account resource and reflects the status', async () => {
    const okFake = fakeTransport(() => ok('{}'));
    const okSms = new TwilioSmsAdapter({ ...base, transport: okFake.transport });
    expect(await okSms.checkHealth()).toBe(true);
    expect(okFake.requests[0]!.url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC123.json');

    const badFake = fakeTransport(() => ({ status: 401, body: 'unauthorized' }));
    const badSms = new TwilioSmsAdapter({ ...base, transport: badFake.transport });
    expect(await badSms.checkHealth()).toBe(false);
  });

  it('requires its credentials', () => {
    expect(() => new TwilioSmsAdapter({ accountSid: '', authToken: 't', from: 'f' })).toThrow();
  });
});

describe('VpsStorageAdapter (G1.1 — the operator-controlled store)', () => {
  it('PUTs to the remote store and serves reads from the write-through cache', async () => {
    const fake = fakeTransport(() => ok());
    const store = new VpsStorageAdapter({ baseUrl: 'https://store.myvps/blobs', authToken: 's3cret', transport: fake.transport });
    store.put('env/abc', 'CIPHERTEXT');
    await store.drain();

    const put = fake.requests[0]!;
    expect(put.method).toBe('PUT');
    expect(put.url).toBe('https://store.myvps/blobs/env%2Fabc');
    expect(put.headers?.['authorization']).toBe('Bearer s3cret');
    expect(put.body).toBe('CIPHERTEXT');
    expect(store.get('env/abc')).toBe('CIPHERTEXT');
  });

  it('probe round-trips a canary and is healthy only on a faithful echo', async () => {
    const blobs = new Map<string, string>();
    const fake = fakeTransport((req) => {
      const key = req.url;
      if (req.method === 'PUT') {
        blobs.set(key, req.body ?? '');
        return ok();
      }
      if (req.method === 'GET') {
        const v = blobs.get(key);
        return v === undefined ? { status: 404, body: '' } : ok(v);
      }
      return ok(); // DELETE
    });
    const store = new VpsStorageAdapter({ baseUrl: 'https://store.myvps/blobs', transport: fake.transport });
    expect(await store.checkHealth()).toBe(true);
  });

  it('is unhealthy when the canary does not round-trip', async () => {
    const fake = fakeTransport((req) => (req.method === 'GET' ? ok('SOMETHING ELSE') : ok()));
    const store = new VpsStorageAdapter({ baseUrl: 'https://store.myvps/blobs', transport: fake.transport });
    expect(await store.checkHealth()).toBe(false);
  });

  it('getRemote returns the body on 200 and undefined on 404', async () => {
    const fake = fakeTransport((req) => (req.url.endsWith('present') ? ok('BYTES') : { status: 404, body: '' }));
    const store = new VpsStorageAdapter({ baseUrl: 'https://store.myvps/blobs', transport: fake.transport });
    expect(await store.getRemote('present')).toBe('BYTES');
    expect(await store.getRemote('absent')).toBeUndefined();
  });
});

describe('HttpEmailAdapter (G1.1 — vendor-neutral email endpoint)', () => {
  it('POSTs a JSON envelope and reflects health', async () => {
    const fake = fakeTransport(() => ({ status: 202, body: '' }));
    const email = new HttpEmailAdapter({ sendUrl: 'https://mail.myvps/send', authToken: 'k', transport: fake.transport });
    email.sendEmail('r@x.test', 'You have a message', 'Open your message: https://app/release?a=..');
    await email.drain();

    const req = fake.requests[0]!;
    expect(req.method).toBe('POST');
    expect(req.headers?.['content-type']).toBe('application/json');
    const parsed = JSON.parse(req.body ?? '{}');
    expect(parsed).toEqual({ to: 'r@x.test', subject: 'You have a message', body: 'Open your message: https://app/release?a=..' });
    expect(email.probe()).toBe(true);
  });
});

describe('vendor wiring (G1.1)', () => {
  const ENV = {
    LV_TWILIO_ACCOUNT_SID: 'AC1',
    LV_TWILIO_AUTH_TOKEN: 'tok',
    LV_TWILIO_FROM: '+8801000',
    LV_STORAGE_BASE_URL: 'https://store.myvps/blobs',
    LV_STORAGE_TOKEN: 'st',
    LV_EMAIL_SEND_URL: 'https://mail.myvps/send',
  };

  it('reads config from the environment and builds the real adapters behind the ports', () => {
    const config = vendorConfigFromEnv(ENV as NodeJS.ProcessEnv);
    expect(config.sms.accountSid).toBe('AC1');
    expect(config.storage.baseUrl).toBe('https://store.myvps/blobs');
    const channels = createVendorChannels(config);
    expect(channels.sms).toBeInstanceOf(TwilioSmsAdapter);
    expect(channels.storage).toBeInstanceOf(VpsStorageAdapter);
    expect(channels.email).toBeInstanceOf(HttpEmailAdapter);
    // push has no chosen vendor and is not a health dependency — it stays a dumb port.
    expect(typeof channels.push.sendPush).toBe('function');
  });

  it('throws when a required secret is absent (fails closed)', () => {
    const { LV_TWILIO_AUTH_TOKEN: _omit, ...partial } = ENV;
    expect(() => vendorConfigFromEnv(partial as NodeJS.ProcessEnv)).toThrow();
  });
});
