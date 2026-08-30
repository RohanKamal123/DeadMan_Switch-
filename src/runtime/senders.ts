// Cadence senders (DECISIONS.md §12 Phase E: "wire src/notifications/ schedules
// to the channels"). The scheduler turns a due reminder into rendered, static
// template copy and hands it to a `ReminderSender`; the real channel adapters
// (email / SMS / push) are Phase G and plug in behind this interface.
//
// INVARIANT 6 holds structurally: a reminder carries only rendered template
// text — the templates themselves embed no link, code, or content, and there is
// no field here to attach one. NUDGE reminders reach the user only (invariant 2);
// the cadence module already fixes which channels each reminder uses.

import type { Channel } from '../notifications/cadence';
import {
  render,
  TEMPLATE_IDS,
  type TemplateContext,
  type TemplateId,
} from '../notifications/templates';

export interface OutboundReminder {
  readonly accountId: string;
  readonly channel: Channel;
  readonly templateId: string;
  readonly day: number;
  /** Rendered static template text. Never a link, code, or content (invariant 6). */
  readonly body: string;
}

export interface ReminderSender {
  send(message: OutboundReminder): void;
}

export interface OutboundAlert {
  readonly at: number;
  readonly message: string;
}

export interface AlertSender {
  alert(alert: OutboundAlert): void;
}

/** Test / dev sender that records what would be sent instead of hitting a channel. */
export class RecordingReminderSender implements ReminderSender {
  readonly sent: OutboundReminder[] = [];
  send(message: OutboundReminder): void {
    this.sent.push(message);
  }
}

export class RecordingAlertSender implements AlertSender {
  readonly alerts: OutboundAlert[] = [];
  alert(alert: OutboundAlert): void {
    this.alerts.push(alert);
  }
}

function isTemplateId(id: string): id is TemplateId {
  return (TEMPLATE_IDS as readonly string[]).includes(id);
}

/** Render a scheduled reminder's static copy, refusing an unknown template id. */
export function renderReminderBody(templateId: string, context: TemplateContext): string {
  if (!isTemplateId(templateId)) {
    throw new Error(`unknown template id: ${templateId}`);
  }
  return render(templateId, context);
}
