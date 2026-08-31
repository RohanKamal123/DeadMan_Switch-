// Billing — the plan catalogue and the entitlements each plan grants.
//
// A hard rule governs this whole module, and it is the billing equivalent of the
// product's one rule: BILLING NEVER CHANGES THE DEATH PATH. A plan limit can
// block a NEW expanding action (adding a sixth recipient on a plan that allows
// five), but a lapsed or downgraded subscription must never silently drop a
// recipient, disable a public release the user already turned on, or otherwise
// alter what the account is already configured to do. Money decides what you can
// newly set up, never what happens when you have died. So entitlements are
// consulted at the moment of an expanding change and nowhere in the release
// engine.
//
// Prices are catalogue metadata for display and for creating a checkout; the
// authoritative price always lives in the payment provider. Nothing here is a
// secret and nothing here talks to a network.

export type PlanId = 'free' | 'personal' | 'vault';

export const PLAN_IDS: readonly PlanId[] = ['free', 'personal', 'vault'];

/** Everything a plan is allowed to do. Numbers are inclusive caps; Infinity = no cap. */
export interface Entitlements {
  readonly planId: PlanId;
  readonly maxRecipients: number;
  readonly maxContacts: number;
  readonly maxStorageMb: number;
  /** Strict evidence mode (death-certificate required before release). */
  readonly strictMode: boolean;
  /** May turn on public release to a chosen destination. */
  readonly publicRelease: boolean;
  /** May enable opt-in passive liveness signals. */
  readonly passiveSignals: boolean;
  /** Receives the quarterly contact-rot drill. */
  readonly quarterlyDrill: boolean;
  readonly prioritySupport: boolean;
}

export interface Plan {
  readonly id: PlanId;
  readonly name: string;
  readonly tagline: string;
  /** Price in the smallest currency unit (cents) per month; 0 for free. */
  readonly priceCents: number;
  readonly currency: 'usd';
  /** Human bullet points for the pricing page. */
  readonly includes: readonly string[];
  readonly entitlements: Entitlements;
}

const FREE: Plan = {
  id: 'free',
  name: 'Keepsake',
  tagline: 'One message, one person, no cost. Prove to yourself it works.',
  priceCents: 0,
  currency: 'usd',
  includes: [
    'One recipient, up to three contacts',
    'Weekly check-in and the 30-day nudge ladder',
    'Human verification and the full cancel window',
    'The no-login stop link',
    '25 MB of encrypted content',
  ],
  entitlements: {
    planId: 'free',
    maxRecipients: 1,
    maxContacts: 3,
    maxStorageMb: 25,
    strictMode: false,
    publicRelease: false,
    passiveSignals: false,
    quarterlyDrill: false,
    prioritySupport: false,
  },
};

const PERSONAL: Plan = {
  id: 'personal',
  name: 'Legacy',
  tagline: 'For a whole household’s worth of people and instructions.',
  priceCents: 900,
  currency: 'usd',
  includes: [
    'Up to five recipients and twenty contacts',
    'Strict evidence mode (death-certificate required)',
    'Public release to a destination you choose',
    'Opt-in passive liveness signals',
    'The quarterly contact-rot drill',
    '2 GB of encrypted content',
  ],
  entitlements: {
    planId: 'personal',
    maxRecipients: 5,
    maxContacts: 20,
    maxStorageMb: 2048,
    strictMode: true,
    publicRelease: true,
    passiveSignals: true,
    quarterlyDrill: true,
    prioritySupport: false,
  },
};

const VAULT: Plan = {
  id: 'vault',
  name: 'Estate',
  tagline: 'Unlimited people, priority support, everything on.',
  priceCents: 2900,
  currency: 'usd',
  includes: [
    'Unlimited recipients and contacts',
    'Everything in Legacy',
    'Priority human support',
    '25 GB of encrypted content',
  ],
  entitlements: {
    planId: 'vault',
    maxRecipients: Number.POSITIVE_INFINITY,
    maxContacts: Number.POSITIVE_INFINITY,
    maxStorageMb: 25600,
    strictMode: true,
    publicRelease: true,
    passiveSignals: true,
    quarterlyDrill: true,
    prioritySupport: true,
  },
};

const CATALOGUE: Record<PlanId, Plan> = { free: FREE, personal: PERSONAL, vault: VAULT };

export function allPlans(): readonly Plan[] {
  return PLAN_IDS.map((id) => CATALOGUE[id]);
}

export function planById(id: PlanId): Plan {
  return CATALOGUE[id];
}

export function isPlanId(value: string): value is PlanId {
  return (PLAN_IDS as readonly string[]).includes(value);
}

/** Entitlements for a plan; unknown ids fail safe to the free plan (least access). */
export function entitlementsFor(id: PlanId | undefined): Entitlements {
  if (id === undefined || !isPlanId(id)) return FREE.entitlements;
  return CATALOGUE[id].entitlements;
}

/** Human-readable price, e.g. "Free" or "$9/mo". */
export function priceLabel(plan: Plan): string {
  if (plan.priceCents === 0) return 'Free';
  const whole = plan.priceCents / 100;
  const text = Number.isInteger(whole) ? String(whole) : whole.toFixed(2);
  return `$${text}/mo`;
}
