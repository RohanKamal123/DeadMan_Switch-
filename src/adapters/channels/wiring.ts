// Phase G — wiring the vendor ports into the runtime (DECISIONS_PHASE_F_G.md G1).
//
// Turns the dumb-pipe ports into the interfaces the rest of the system already
// expects:
//   - `dependencyProbers` → the weekly health check's `Record<Dependency, Prober>`
//     (§6). A failing real probe drives the same veto path 3 that blocks entry
//     to VERIFYING — no new logic, just a real signal.
//   - `ChannelReminderSender` implements `ReminderSender`, routing a rendered
//     reminder to the right port by channel. Reminders carry only static
//     template text (invariant 6).
//   - `ChannelAlertSender` implements `AlertSender`, emailing the ops team.
//   - `DeliveryDispatcher` sends the release engine's `DeliveryMessage`s: the
//     gated email carries ONLY a link (built from a base URL), the SMS ONLY the
//     code — channel separation is structural (invariant 6).

import type { Dependency, Prober } from '../../health/health';
import type { Channel } from '../../notifications/cadence';
import type { AlertSender, OutboundAlert, OutboundReminder, ReminderSender } from '../../runtime';
import type { DeliveryMessage } from '../../delivery';
import type { EmailPort, PushPort, SmsPort, StoragePort } from './ports';

export interface Channels {
  readonly email: EmailPort;
  readonly sms: SmsPort;
  readonly push: PushPort;
  readonly storage: StoragePort;
}

/** Health probers for the three tracked dependencies (§3.2): email, sms, storage. */
export function dependencyProbers(channels: Channels): Record<Dependency, Prober> {
  return {
    email: () => channels.email.probe(),
    sms: () => channels.sms.probe(),
    storage: () => channels.storage.probe(),
  };
}

const REMINDER_SUBJECT = 'A reminder from Legacy Vault';

export class ChannelReminderSender implements ReminderSender {
  constructor(private readonly channels: Channels) {}

  send(message: OutboundReminder): void {
    dispatchToChannel(this.channels, message.channel, message.body, REMINDER_SUBJECT);
  }
}

export interface ChannelAlertSenderOptions {
  readonly channels: Channels;
  /** The company-owned ops address alerts are emailed to (§6). */
  readonly opsEmail: string;
}

export class ChannelAlertSender implements AlertSender {
  private readonly channels: Channels;
  private readonly opsEmail: string;
  constructor(options: ChannelAlertSenderOptions) {
    this.channels = options.channels;
    this.opsEmail = options.opsEmail;
  }
  alert(alert: OutboundAlert): void {
    this.channels.email.sendEmail(this.opsEmail, 'Legacy Vault health alert', alert.message);
  }
}

export interface DeliveryDispatcherOptions {
  readonly channels: Channels;
  /** Base URL the gated link is built on, e.g. https://app.example/release. */
  readonly gatedBaseUrl: string;
}

/**
 * Send the release engine's outbound messages over the real channels. A
 * GatedEmail becomes an email carrying only the link; a CodeSms becomes an SMS
 * carrying only the code — the two never travel on the same channel (invariant 6).
 */
export class DeliveryDispatcher {
  private readonly channels: Channels;
  private readonly gatedBaseUrl: string;
  constructor(options: DeliveryDispatcherOptions) {
    this.channels = options.channels;
    this.gatedBaseUrl = options.gatedBaseUrl;
  }

  dispatch(accountId: string, messages: readonly DeliveryMessage[]): void {
    for (const message of messages) {
      if (message.channel === 'email') {
        const url = `${this.gatedBaseUrl}?a=${encodeURIComponent(accountId)}&link=${encodeURIComponent(message.gatedLink)}`;
        this.channels.email.sendEmail(message.to, 'You have a message', `Open your message: ${url}`);
      } else {
        this.channels.sms.sendSms(message.to, `Your one-time code is ${message.code}`);
      }
    }
  }
}

/** Route rendered text to the port for a cadence channel. `in-app` is delivered by the app itself. */
function dispatchToChannel(channels: Channels, channel: Channel, body: string, subject: string): void {
  switch (channel) {
    case 'email':
    case 'email-secondary':
    case 'email-backup':
      channels.email.sendEmail('user', subject, body);
      return;
    case 'sms':
      channels.sms.sendSms('user', body);
      return;
    case 'push':
    case 'push-secondary':
      channels.push.sendPush('user', body);
      return;
    case 'in-app':
      // Delivered in-app; no external channel.
      return;
    default: {
      const _never: never = channel;
      throw new Error(`unhandled channel ${String(_never)}`);
    }
  }
}
