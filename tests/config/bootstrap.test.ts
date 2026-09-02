// Deployment-config resolution (src/config/bootstrap.ts). The governing rule is
// "being wrong is worse than being slow": a named-but-unwired vendor or KMS
// provider must FAIL the boot rather than silently fall back to a dev stand-in,
// and policy numbers are deployment config with conservative defaults — never
// invented in the domain.

import { randomBytes } from 'crypto';
import {
  serverRole,
  contentPolicyFromEnv,
  recipientAccessPolicyFromEnv,
  keyWrapperFromEnv,
  channelsFromEnv,
  blobStoreFromEnv,
} from '../../src/config/bootstrap';
import { cancelSecretsFromEnv, secretsFromEnv, MissingSecretError, type Secrets } from '../../src/adapters/secrets';

const SECRETS: Secrets = {
  cancelTokenSecrets: ['cancel'],
  sessionSecret: 'sess',
  kmsMasterKey: randomBytes(32),
};

function env(overrides: Record<string, string>): NodeJS.ProcessEnv {
  return overrides;
}

describe('serverRole (F1.5)', () => {
  it('defaults to combined', () => {
    expect(serverRole(env({}))).toBe('combined');
  });
  it('accepts api and cancel (case-insensitive)', () => {
    expect(serverRole(env({ LV_SERVER_ROLE: 'API' }))).toBe('api');
    expect(serverRole(env({ LV_SERVER_ROLE: 'cancel' }))).toBe('cancel');
  });
  it('rejects an unknown role rather than guessing', () => {
    expect(() => serverRole(env({ LV_SERVER_ROLE: 'both' }))).toThrow(/LV_SERVER_ROLE/);
  });
});

describe('contentPolicyFromEnv (G5/11.5)', () => {
  it('uses conservative defaults when unset', () => {
    const p = contentPolicyFromEnv(env({}));
    expect(p.maxBytesByKind.note).toBeGreaterThan(0);
    expect(p.maxBytesByKind.photo).toBeGreaterThan(p.maxBytesByKind.note);
    expect(p.allowedMimeTypes.pdf).toContain('application/pdf');
  });
  it('applies per-kind overrides', () => {
    const p = contentPolicyFromEnv(env({ LV_MAX_NOTE_BYTES: '512' }));
    expect(p.maxBytesByKind.note).toBe(512);
  });
  it('rejects a non-integer override rather than guessing', () => {
    expect(() => contentPolicyFromEnv(env({ LV_MAX_PHOTO_BYTES: 'big' }))).toThrow(/positive integer/);
    expect(() => contentPolicyFromEnv(env({ LV_MAX_PDF_BYTES: '-1' }))).toThrow(/positive integer/);
  });
});

describe('recipientAccessPolicyFromEnv (F4.1)', () => {
  it('defaults to a small fixed cap', () => {
    const p = recipientAccessPolicyFromEnv(env({}));
    expect(p?.codeAttemptCap).toBeGreaterThan(0);
  });
  it('honours an explicit cap', () => {
    expect(recipientAccessPolicyFromEnv(env({ LV_RECIPIENT_CODE_ATTEMPT_CAP: '10' }))?.codeAttemptCap).toBe(10);
  });
  it('can be turned off explicitly', () => {
    expect(recipientAccessPolicyFromEnv(env({ LV_RECIPIENT_CODE_ATTEMPT_CAP: 'off' }))).toBeUndefined();
  });
  it('rejects junk', () => {
    expect(() => recipientAccessPolicyFromEnv(env({ LV_RECIPIENT_CODE_ATTEMPT_CAP: '0' }))).toThrow();
    expect(() => recipientAccessPolicyFromEnv(env({ LV_RECIPIENT_CODE_ATTEMPT_CAP: '3.5' }))).toThrow();
  });
});

describe('keyWrapperFromEnv (G2.1)', () => {
  it('builds a local wrapper by default, with a configurable key id', () => {
    const w = keyWrapperFromEnv(SECRETS, env({ LV_KMS_KEY_ID: 'kms-2026' }));
    expect(w.keyId).toBe('kms-2026');
    // Round-trips a data key, proving it is a working wrapper.
    const dk = randomBytes(32);
    expect(w.unwrap(w.keyId, w.wrap(dk)).equals(dk)).toBe(true);
  });
  it('refuses a named-but-unwired provider (no silent fallback to the local key)', () => {
    expect(() => keyWrapperFromEnv(SECRETS, env({ LV_KMS_PROVIDER: 'aws-kms' }))).toThrow(/G2\.1|no KMS adapter/);
  });
});

describe('channelsFromEnv (G1.1 + 1.1 data-localization gate)', () => {
  it('defaults every channel to the in-memory dev stand-in', () => {
    const c = channelsFromEnv(env({}));
    expect(c.email.probe()).toBe(true);
    expect(c.sms.probe()).toBe(true);
    expect(c.storage.probe()).toBe(true);
  });
  it('refuses a named-but-unwired provider rather than routing to the dev sink', () => {
    // A real region + ack, so the failure is specifically "not wired", not the gate.
    // Push has no real adapter yet — a genuinely unwired case (unlike email/sms/storage now).
    expect(() =>
      channelsFromEnv(env({ LV_PUSH_PROVIDER: 'onesignal', LV_VENDOR_DATA_REGION: 'bd' })),
    ).toThrow(/G1\.1|no vendor adapter/);
  });
  it('also refuses an unknown value for a channel that DOES have a wired provider (e.g. sms=nexmo, not twilio)', () => {
    expect(() =>
      channelsFromEnv(env({ LV_SMS_PROVIDER: 'nexmo', LV_VENDOR_DATA_REGION: 'bd' })),
    ).toThrow(/G1\.1|no vendor adapter/);
  });
  it('requires a declared data region for any real vendor (1.1)', () => {
    expect(() => channelsFromEnv(env({ LV_EMAIL_PROVIDER: 'ses' }))).toThrow(/LV_VENDOR_DATA_REGION/);
  });
  it('requires an explicit acknowledgement for a cross-border vendor (1.1)', () => {
    expect(() =>
      channelsFromEnv(env({ LV_EMAIL_PROVIDER: 'ses', LV_VENDOR_DATA_REGION: 'us' })),
    ).toThrow(/cross-border|LV_VENDOR_CROSS_BORDER_ACK/);
  });
});

const R2_ENV = {
  LV_STORAGE_PROVIDER: 'r2',
  LV_VENDOR_DATA_REGION: 'us', // R2 has no Bangladesh region — cross-border by nature
  LV_VENDOR_CROSS_BORDER_ACK: '1',
  LV_R2_ACCOUNT_ID: 'acct123',
  LV_R2_ACCESS_KEY_ID: 'key123',
  LV_R2_SECRET_ACCESS_KEY: 'secret123',
  LV_R2_BUCKET: 'legacy-vault-content',
};

describe('channelsFromEnv — R2 storage selection (G1.1/G2)', () => {
  it('builds a real, working R2 adapter for channels.storage', () => {
    const channels = channelsFromEnv(env(R2_ENV));
    expect(channels.storage.probe()).toBe(false); // conservative default, no traffic yet
  });

  it('validates R2 credentials before ever touching the SDK', () => {
    const { LV_R2_BUCKET: _drop, ...missingBucket } = R2_ENV;
    expect(() => channelsFromEnv(env(missingBucket))).toThrow(/LV_R2_BUCKET/);
  });

  it('still runs the 1.1 data-localization gate for r2 like any other real vendor', () => {
    const { LV_VENDOR_DATA_REGION: _drop, ...noRegion } = R2_ENV;
    expect(() => channelsFromEnv(env(noRegion))).toThrow(/LV_VENDOR_DATA_REGION/);
  });
});

const RESEND_ENV = {
  LV_EMAIL_PROVIDER: 'resend',
  LV_VENDOR_DATA_REGION: 'us',
  LV_VENDOR_CROSS_BORDER_ACK: '1',
  LV_RESEND_API_KEY: 're_123',
  LV_RESEND_FROM_EMAIL: 'Legacy Vault <noreply@x.test>',
};

describe('channelsFromEnv — Resend email selection (G1.1)', () => {
  it('builds a real, working Resend adapter for channels.email', () => {
    const channels = channelsFromEnv(env(RESEND_ENV));
    expect(channels.email.probe()).toBe(false); // conservative default, no traffic yet
  });

  it('validates Resend credentials before ever sending', () => {
    const { LV_RESEND_FROM_EMAIL: _drop, ...missing } = RESEND_ENV;
    expect(() => channelsFromEnv(env(missing))).toThrow(/LV_RESEND_FROM_EMAIL/);
  });

  it('still runs the 1.1 data-localization gate for resend like any other real vendor', () => {
    const { LV_VENDOR_CROSS_BORDER_ACK: _drop, ...noAck } = RESEND_ENV;
    expect(() => channelsFromEnv(env(noAck))).toThrow(/cross-border|LV_VENDOR_CROSS_BORDER_ACK/);
  });
});

const TWILIO_ENV = {
  LV_SMS_PROVIDER: 'twilio',
  LV_VENDOR_DATA_REGION: 'us',
  LV_VENDOR_CROSS_BORDER_ACK: '1',
  LV_TWILIO_ACCOUNT_SID: 'AC123',
  LV_TWILIO_AUTH_TOKEN: 'tok123',
  LV_TWILIO_FROM_NUMBER: '+15550001111',
};

describe('channelsFromEnv — Twilio SMS selection (G1.1)', () => {
  it('builds a real, working Twilio adapter for channels.sms', () => {
    const channels = channelsFromEnv(env(TWILIO_ENV));
    expect(channels.sms.probe()).toBe(false); // conservative default, no traffic yet
  });

  it('validates Twilio credentials before ever sending', () => {
    const { LV_TWILIO_AUTH_TOKEN: _drop, ...missing } = TWILIO_ENV;
    expect(() => channelsFromEnv(env(missing))).toThrow(/LV_TWILIO_AUTH_TOKEN/);
  });

  it('still runs the 1.1 data-localization gate for twilio like any other real vendor', () => {
    const { LV_VENDOR_DATA_REGION: _drop, ...noRegion } = TWILIO_ENV;
    expect(() => channelsFromEnv(env(noRegion))).toThrow(/LV_VENDOR_DATA_REGION/);
  });
});

describe('blobStoreFromEnv (G2/G1.1)', () => {
  it('is undefined by default — ciphertext stays inline in the KV store', () => {
    expect(blobStoreFromEnv(env({}))).toBeUndefined();
  });

  it('builds a real BlobStore when r2 is selected (shape only — no real network call here)', () => {
    const blobStore = blobStoreFromEnv(env(R2_ENV));
    expect(blobStore).toBeDefined();
    expect(typeof blobStore!.put).toBe('function');
    expect(typeof blobStore!.get).toBe('function');
    expect(typeof blobStore!.delete).toBe('function');
  });

  it('validates R2 credentials independently of channelsFromEnv', () => {
    const { LV_R2_ACCESS_KEY_ID: _drop, ...missingKey } = R2_ENV;
    expect(() => blobStoreFromEnv(env(missingKey))).toThrow(/LV_R2_ACCESS_KEY_ID/);
  });
});

describe('cancel secrets isolation (F1.5)', () => {
  it('reads the cancel secret WITHOUT requiring the KMS key or session secret', () => {
    // The isolated cancel process must boot on the signing secret alone.
    const secrets = cancelSecretsFromEnv(env({ LV_CANCEL_SECRET: 'c1', LV_CANCEL_SECRET_PREVIOUS: 'c0' }));
    expect(secrets).toEqual(['c1', 'c0']);
  });
  it('the full secret loader still requires the KMS key', () => {
    expect(() => secretsFromEnv(env({ LV_CANCEL_SECRET: 'c1', LV_SESSION_SECRET: 's' }))).toThrow(MissingSecretError);
  });
});
