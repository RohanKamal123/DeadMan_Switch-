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
    expect(() =>
      channelsFromEnv(env({ LV_SMS_PROVIDER: 'twilio', LV_VENDOR_DATA_REGION: 'bd' })),
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
