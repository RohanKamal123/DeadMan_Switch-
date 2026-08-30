// Static, human-written template copy (DECISIONS.md 3.1; UX_SPEC.md §1.5 / §1.6
// / §1.7). No language is generated at runtime — a template cannot hallucinate.
// The copy never asserts the user has died, NUDGE copy states no one else was
// contacted (invariant 2), and no template embeds a URL or an access code
// (invariant 6). The only interpolated values are decided timer numbers.

export interface TemplateContext {
  readonly daysRemaining: number;
  readonly checkInDueDays: number;
}

export const TEMPLATE_IDS = [
  'nudge.day7',
  'nudge.day14',
  'nudge.day21',
  'hold.cancelPrompt',
  'stalled.alert',
  'cancelled.falseAlarm',
  'confirmer.holdNotice',
] as const;

export type TemplateId = (typeof TEMPLATE_IDS)[number];

const TEMPLATES: Record<TemplateId, (c: TemplateContext) => string> = {
  'nudge.day7': () =>
    "We haven't heard from you in a little while. A quick check-in puts everything back to normal. " +
    "We haven't contacted anyone else — this is just between us.",

  'nudge.day14': () =>
    "We still haven't heard from you. Please open the app and check in when you can. " +
    "No one else has been contacted, and nothing has been shared.",

  'nudge.day21': () =>
    "It's been a few weeks since your last check-in. Please check in so we know you're okay. " +
    "We have not contacted anyone else.",

  'hold.cancelPrompt': (c) =>
    `A hold is running because we weren't able to confirm you're okay. Nothing has been released. ` +
    `This hold ends in ${c.daysRemaining} days — but if you're reading this, tap "I'm alive — stop everything" ` +
    `and it all stops, at any point, including the last second.`,

  'stalled.alert': () =>
    "We tried to reach people and couldn't confirm anything. Nothing will be released, and not being " +
    "able to confirm is not being treated as bad news. Please check in or contact us.",

  'cancelled.falseAlarm': () =>
    "Everything's stopped and reset. We let the people we'd contacted know it was a false alarm. " +
    "There's nothing more you need to do.",

  'confirmer.holdNotice': () =>
    "A waiting period is running on an account that named you. If you were contacted by mistake, you can " +
    "withdraw. This message carries nothing to open and asks nothing of you beyond that.",
};

export function render(id: TemplateId, context: TemplateContext): string {
  const template = TEMPLATES[id];
  if (template === undefined) {
    throw new Error(`unknown template id: ${String(id)}`);
  }
  return template(context);
}
