// The runnable entrypoint's engine (bootstrap.ts). Config validation and the
// durable audit factory are unit-tested here without opening a socket. The rule
// under test: policy VALUES arrive as deployment config and secrets come from the
// environment — nothing is invented in code, and a config gap fails loudly.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  ConfigError,
  buildAppConfig,
  durableAuditFactory,
  loadOpsConfig,
  parseOpsConfig,
  type OpsConfig,
} from '../src/bootstrap';

function validRaw(): Record<string, unknown> {
  return {
    apiPort: 8080,
    cancelPort: 8081,
    schedulerIntervalMs: 60_000,
    sessionTtlMs: 3_600_000,
    opsEmail: 'ops@company.example',
    gatedBaseUrl: 'https://app.example/release',
    cancelFallback: { supportUrl: 'https://app.example/support', inAppCancelUrl: 'https://app.example/cancel' },
    storage: { statePath: 'data/state.json', cursorPath: 'data/cursors.json', credentialsPath: 'data/creds.json', auditDir: 'data/audit' },
    contentPolicy: {
      maxBytesByKind: { note: 10_000, photo: 5_000_000, pdf: 10_000_000 },
      allowedMimeTypes: { note: ['text/plain'], photo: ['image/jpeg'], pdf: ['application/pdf'] },
    },
    recipientAccessPolicy: { maxCodeAttempts: 5, maxReissues: 5 },
  };
}

function fullEnv(dir: string): NodeJS.ProcessEnv {
  return {
    LV_CANCEL_SECRET: 'cancel-secret',
    LV_SESSION_SECRET: 'session-secret',
    LV_KMS_MASTER_KEY: 'a'.repeat(64), // 32 bytes hex
    LV_TWILIO_ACCOUNT_SID: 'AC1',
    LV_TWILIO_AUTH_TOKEN: 'tok',
    LV_TWILIO_FROM: '+8801000',
    LV_STORAGE_BASE_URL: 'https://store.myvps/blobs',
    LV_EMAIL_SEND_URL: 'https://mail.myvps/send',
  } as NodeJS.ProcessEnv;
}

describe('parseOpsConfig', () => {
  it('accepts a complete config and carries the policy values through', () => {
    const ops = parseOpsConfig(validRaw());
    expect(ops.apiPort).toBe(8080);
    expect(ops.recipientAccessPolicy).toEqual({ maxCodeAttempts: 5, maxReissues: 5 });
    expect(ops.contentPolicy.maxBytesByKind.pdf).toBe(10_000_000);
    expect(ops.cancelFallback.supportUrl).toBe('https://app.example/support');
  });

  it('rejects a missing required field with a ConfigError naming it', () => {
    const raw = validRaw();
    delete raw['opsEmail'];
    expect(() => parseOpsConfig(raw)).toThrow(ConfigError);
    expect(() => parseOpsConfig(raw)).toThrow(/opsEmail/);
  });

  it('rejects a content policy missing a kind limit', () => {
    const raw = validRaw();
    (raw['contentPolicy'] as any).maxBytesByKind = { note: 1, photo: 2 }; // pdf missing
    expect(() => parseOpsConfig(raw)).toThrow(/pdf/);
  });

  it('rejects a non-object', () => {
    expect(() => parseOpsConfig('nope')).toThrow(ConfigError);
  });

  it('treats an omitted cancelFallback as empty (still valid — page has static copy)', () => {
    const raw = validRaw();
    delete raw['cancelFallback'];
    const ops = parseOpsConfig(raw);
    expect(ops.cancelFallback).toEqual({});
  });
});

describe('loadOpsConfig', () => {
  it('reads and parses the file named by LV_CONFIG_FILE', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-cfg-'));
    const file = path.join(dir, 'config.json');
    fs.writeFileSync(file, JSON.stringify(validRaw()), 'utf8');
    const ops = loadOpsConfig({ LV_CONFIG_FILE: file } as NodeJS.ProcessEnv);
    expect(ops.apiPort).toBe(8080);
  });

  it('throws when LV_CONFIG_FILE is unset', () => {
    expect(() => loadOpsConfig({} as NodeJS.ProcessEnv)).toThrow(ConfigError);
  });
});

describe('durableAuditFactory', () => {
  it('writes a verifiable per-account hash-chained trail and sanitizes the account id', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-audit-'));
    const factory = durableAuditFactory(dir);
    // A hostile id must not escape the audit directory.
    const sink = factory('../../etc/passwd');
    sink.append({ at: 1, kind: 'OUTREACH', event: 'TEST', metadata: {} });

    const files = fs.readdirSync(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).not.toContain('/');
    expect(files[0]).not.toContain('..');

    // Reloading the same account re-reads and verifies the chain without throwing.
    const reloaded = factory('../../etc/passwd') as any;
    expect(reloaded.verify().ok).toBe(true);
  });
});

describe('buildAppConfig', () => {
  it('assembles an AppConfig from ops + env, wiring durable file stores and real vendors', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-app-'));
    const ops: OpsConfig = {
      ...parseOpsConfig(validRaw()),
      storage: {
        statePath: path.join(dir, 'state.json'),
        cursorPath: path.join(dir, 'cursors.json'),
        credentialsPath: path.join(dir, 'creds.json'),
        auditDir: path.join(dir, 'audit'),
      },
    };
    const built = buildAppConfig(ops, fullEnv(dir));
    expect(built.config.recipientAccessPolicy).toEqual({ maxCodeAttempts: 5, maxReissues: 5 });
    expect(built.config.schedulerIntervalMs).toBe(60_000);
    expect(built.channels.sms).toBeDefined();
    expect(built.config.secrets.cancelTokenSecrets[0]).toBe('cancel-secret');
  });

  it('fails when a required secret is absent (fails closed)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-app-'));
    const ops = parseOpsConfig(validRaw());
    const env = fullEnv(dir);
    delete env['LV_KMS_MASTER_KEY'];
    expect(() => buildAppConfig(ops, env)).toThrow();
  });
});
