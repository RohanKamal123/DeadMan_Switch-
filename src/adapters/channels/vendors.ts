// Phase G — production vendor wiring (DECISIONS_PHASE_F_G.md G1 / G1.1).
//
// Assembles the `Channels` bundle from injected configuration using the chosen
// real adapters: Twilio for SMS, the operator's own VPS for storage, and a
// vendor-neutral HTTP endpoint for email. Push has no chosen vendor and is not a
// health dependency (§3.2 tracks email/sms/storage only), so it stays on the
// in-memory port until a push vendor is selected — a one-line change here, never
// a change to the callers (G1). Credentials are injected (G4); this module reads
// them from the environment and never logs them.

import type { Channels } from './wiring';
import { InMemoryPushAdapter } from './ports';
import { TwilioSmsAdapter, type TwilioSmsConfig } from './twilio';
import { VpsStorageAdapter, type VpsStorageConfig } from './vps-storage';
import { HttpEmailAdapter, type HttpEmailConfig } from './http-email';

export interface VendorConfig {
  readonly sms: TwilioSmsConfig;
  readonly storage: VpsStorageConfig;
  readonly email: HttpEmailConfig;
}

export interface VendorChannels extends Channels {
  readonly email: HttpEmailAdapter;
  readonly sms: TwilioSmsAdapter;
  readonly storage: VpsStorageAdapter;
}

/** Build the real-vendor `Channels` from explicit config. */
export function createVendorChannels(config: VendorConfig): VendorChannels {
  return {
    email: new HttpEmailAdapter(config.email),
    sms: new TwilioSmsAdapter(config.sms),
    push: new InMemoryPushAdapter(),
    storage: new VpsStorageAdapter(config.storage),
  };
}

class MissingVendorConfigError extends Error {
  constructor(name: string) {
    super(`required vendor config ${name} is not set`);
    this.name = 'MissingVendorConfigError';
  }
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (value === undefined || value === '') throw new MissingVendorConfigError(name);
  return value;
}

function optional(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name];
  return value === undefined || value === '' ? undefined : value;
}

/**
 * Read vendor configuration from the environment. Names:
 *   Twilio (SMS):
 *     LV_TWILIO_ACCOUNT_SID   (required)
 *     LV_TWILIO_AUTH_TOKEN    (required)
 *     LV_TWILIO_FROM          (required — E.164 number or Messaging Service SID)
 *     LV_TWILIO_BASE_URL      (optional — regional edge)
 *   VPS storage:
 *     LV_STORAGE_BASE_URL     (required)
 *     LV_STORAGE_TOKEN        (optional bearer)
 *   HTTP email:
 *     LV_EMAIL_SEND_URL       (required)
 *     LV_EMAIL_HEALTH_URL     (optional; defaults to the send URL)
 *     LV_EMAIL_TOKEN          (optional bearer)
 */
export function vendorConfigFromEnv(env: NodeJS.ProcessEnv = process.env): VendorConfig {
  return {
    sms: {
      accountSid: required(env, 'LV_TWILIO_ACCOUNT_SID'),
      authToken: required(env, 'LV_TWILIO_AUTH_TOKEN'),
      from: required(env, 'LV_TWILIO_FROM'),
      ...(optional(env, 'LV_TWILIO_BASE_URL') !== undefined ? { baseUrl: optional(env, 'LV_TWILIO_BASE_URL')! } : {}),
    },
    storage: {
      baseUrl: required(env, 'LV_STORAGE_BASE_URL'),
      ...(optional(env, 'LV_STORAGE_TOKEN') !== undefined ? { authToken: optional(env, 'LV_STORAGE_TOKEN')! } : {}),
    },
    email: {
      sendUrl: required(env, 'LV_EMAIL_SEND_URL'),
      ...(optional(env, 'LV_EMAIL_HEALTH_URL') !== undefined ? { healthUrl: optional(env, 'LV_EMAIL_HEALTH_URL')! } : {}),
      ...(optional(env, 'LV_EMAIL_TOKEN') !== undefined ? { authToken: optional(env, 'LV_EMAIL_TOKEN')! } : {}),
    },
  };
}

/**
 * Seed the cached health of the real adapters with a real check before serving,
 * so the first weekly probe reflects reality rather than the optimistic default.
 * Best-effort: a failed seed just leaves the adapter reporting unhealthy (the
 * conservative direction).
 */
export async function seedVendorHealth(channels: VendorChannels): Promise<void> {
  await Promise.allSettled([
    channels.email.checkHealth(),
    channels.sms.checkHealth(),
    channels.storage.checkHealth(),
  ]);
}
