// Billing — the gate functions. Each answers one question: "may this account
// take this NEW expanding action, given its entitlements?" They return the same
// {ok} | {ok:false, reason} shape the application services already use, so a
// service can consult a gate and surface the reason without new plumbing.
//
// None of these is ever called from the release engine. They guard set-up
// choices (adding people, turning public release on, choosing strict mode),
// never what happens at release time — a lapse must not change a configured
// death path (plans.ts).

import type { Entitlements } from './plans';

export type Gate = { readonly ok: true } | { readonly ok: false; readonly reason: string };

const OK: Gate = { ok: true };

function cap(noun: string, limit: number): string {
  if (limit === Number.POSITIVE_INFINITY) return `Your plan has no ${noun} limit.`;
  return `Your plan allows up to ${limit} ${noun}. Upgrade to add more.`;
}

/** May the account add one more recipient, given how many it already has? */
export function checkAddRecipient(currentCount: number, ent: Entitlements): Gate {
  return currentCount < ent.maxRecipients ? OK : { ok: false, reason: cap('recipients', ent.maxRecipients) };
}

/** May the account add one more contact? */
export function checkAddContact(currentCount: number, ent: Entitlements): Gate {
  return currentCount < ent.maxContacts ? OK : { ok: false, reason: cap('contacts', ent.maxContacts) };
}

/** May the account store `addMb` more, given current usage? */
export function checkStorage(currentMb: number, addMb: number, ent: Entitlements): Gate {
  return currentMb + addMb <= ent.maxStorageMb
    ? OK
    : { ok: false, reason: `Your plan includes ${ent.maxStorageMb} MB of encrypted content. Upgrade for more.` };
}

/** May the account turn on public release? */
export function checkPublicRelease(ent: Entitlements): Gate {
  return ent.publicRelease ? OK : { ok: false, reason: 'Public release is available on a paid plan.' };
}

/** May the account choose strict (death-certificate) evidence mode? */
export function checkStrictMode(ent: Entitlements): Gate {
  return ent.strictMode ? OK : { ok: false, reason: 'Strict evidence mode is available on a paid plan.' };
}

/** May the account enable opt-in passive liveness signals? */
export function checkPassiveSignals(ent: Entitlements): Gate {
  return ent.passiveSignals ? OK : { ok: false, reason: 'Passive liveness signals are available on a paid plan.' };
}
