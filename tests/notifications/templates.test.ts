// Static template copy (DECISIONS.md 3.1; UX_SPEC.md §1.5 / §1.6). Templates
// are human-written and never generated at runtime. The interface never claims
// certainty it does not have, and NUDGE copy states no one else was contacted.

import { render, TEMPLATE_IDS } from '../../src/notifications/templates';

describe('templates', () => {
  it('never assert the user has died', () => {
    for (const id of TEMPLATE_IDS) {
      const text = render(id, { daysRemaining: 12, checkInDueDays: 7 });
      expect(text.toLowerCase()).not.toMatch(/you have died|you are dead|confirmed dead/);
    }
  });

  it('NUDGE copy states no one else has been contacted (invariant 2)', () => {
    const day7 = render('nudge.day7', { daysRemaining: 0, checkInDueDays: 0 });
    expect(day7.toLowerCase()).toMatch(/haven't contacted anyone|no one else/);
  });

  it('the HOLD cancel copy offers a one-tap stop and shows the remaining days', () => {
    const text = render('hold.cancelPrompt', { daysRemaining: 12, checkInDueDays: 0 });
    expect(text).toMatch(/12/);
    expect(text.toLowerCase()).toMatch(/stop everything|i'?m alive/);
  });

  it('no template embeds a URL or a numeric code (invariant 6)', () => {
    for (const id of TEMPLATE_IDS) {
      const text = render(id, { daysRemaining: 5, checkInDueDays: 7 });
      expect(text).not.toMatch(/https?:\/\//);
      expect(text).not.toMatch(/\b\d{6}\b/); // a 6-digit access code
    }
  });

  it('the false-alarm copy reassures and mentions the reset', () => {
    const text = render('cancelled.falseAlarm', { daysRemaining: 0, checkInDueDays: 7 });
    expect(text.toLowerCase()).toMatch(/stopped|reset|false alarm/);
  });

  it('throws on an unknown template id', () => {
    // @ts-expect-error unknown id
    expect(() => render('nope.nope', { daysRemaining: 0, checkInDueDays: 0 })).toThrow();
  });
});
