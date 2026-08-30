// Phase G — vendor channel adapters + wiring (DECISIONS_PHASE_F_G.md G1).

import { runHealthCheck } from '../../src/health/health';
import type { DeliveryMessage } from '../../src/delivery';
import {
  ChannelAlertSender,
  ChannelReminderSender,
  DeliveryDispatcher,
  dependencyProbers,
  InMemoryEmailAdapter,
  InMemoryPushAdapter,
  InMemorySmsAdapter,
  InMemoryStorageAdapter,
  type Channels,
} from '../../src/adapters';

function channels(): Channels & {
  email: InMemoryEmailAdapter;
  sms: InMemorySmsAdapter;
  push: InMemoryPushAdapter;
  storage: InMemoryStorageAdapter;
} {
  return {
    email: new InMemoryEmailAdapter(),
    sms: new InMemorySmsAdapter(),
    push: new InMemoryPushAdapter(),
    storage: new InMemoryStorageAdapter(),
  };
}

describe('dependencyProbers → health check', () => {
  it('reports all healthy when every port probes ok', () => {
    const report = runHealthCheck(dependencyProbers(channels()), 0);
    expect(report.allOk).toBe(true);
  });

  it('reports the failed dependency when a port is unhealthy (drives veto path 3)', () => {
    const ch = channels();
    ch.sms.healthy = false;
    const report = runHealthCheck(dependencyProbers(ch), 0);
    expect(report.allOk).toBe(false);
    expect(report.failed).toContain('sms');
  });
});

describe('ChannelReminderSender', () => {
  it('routes each cadence channel to the right port; in-app hits no external channel', () => {
    const ch = channels();
    const sender = new ChannelReminderSender(ch);
    sender.send({ accountId: 'a', channel: 'email', templateId: 't', day: 7, body: 'hello' });
    sender.send({ accountId: 'a', channel: 'sms', templateId: 't', day: 14, body: 'hello' });
    sender.send({ accountId: 'a', channel: 'push', templateId: 't', day: 21, body: 'hello' });
    sender.send({ accountId: 'a', channel: 'in-app', templateId: 't', day: 7, body: 'hello' });
    expect(ch.email.sent).toHaveLength(1);
    expect(ch.sms.sent).toHaveLength(1);
    expect(ch.push.sent).toHaveLength(1);
  });
});

describe('ChannelAlertSender', () => {
  it('emails the ops address on an alert', () => {
    const ch = channels();
    new ChannelAlertSender({ channels: ch, opsEmail: 'ops@company.test' }).alert({ at: 0, message: 'sms down' });
    expect(ch.email.sent[0]!.to).toBe('ops@company.test');
    expect(ch.email.sent[0]!.body).toContain('sms down');
  });
});

describe('DeliveryDispatcher', () => {
  it('sends the gated link by email and the code by SMS — separate channels (invariant 6)', () => {
    const ch = channels();
    const dispatcher = new DeliveryDispatcher({ channels: ch, gatedBaseUrl: 'https://app.test/release' });
    const messages: DeliveryMessage[] = [
      { channel: 'email', to: 'r@t.test', gatedLink: 'link-123' },
      { channel: 'sms', to: '+1555', code: '654321' },
    ];
    dispatcher.dispatch('acct', messages);

    expect(ch.email.sent[0]!.body).toContain('link-123');
    expect(ch.email.sent[0]!.body).not.toContain('654321'); // no code in the email
    expect(ch.sms.sent[0]!.body).toContain('654321');
    expect(ch.sms.sent[0]!.body).not.toContain('link-123'); // no link in the SMS
  });
});
