// Recipient-access policy (DECISIONS_PHASE_F_G.md F4.1).
//
// The numeric attempt cap and re-issue throttle for the recipient gated page are
// DEPLOYMENT CONFIG, never a threshold invented in the domain — exactly as the
// content size limits are (`ContentPolicy`, DECISIONS.md 11.5). CLAUDE.md forbids
// introducing a threshold the spec does not state; so the enforcement SEAM lives
// in code (the release controller consults this policy) while the numbers arrive
// per environment as a `RecipientAccessPolicy` value.
//
// Both caps push access in the conservative direction (they only ever DELAY a
// recipient — never advance the machine or release content early), consistent
// with the governing rule that being slow is cheaper than being wrong.

export interface RecipientAccessPolicy {
  /**
   * Max failed code entries against a single issued code before that code is
   * dead and a re-issue is required. Throttles guessing without inventing a
   * spec-silent lockout policy in the domain. A small fixed number (e.g. 5).
   */
  readonly maxCodeAttempts: number;
  /**
   * Max re-issues per recipient within the post-release retention window
   * (DECISIONS.md 5.1). Bounds how many fresh codes a single link can mint, so
   * an attacker who holds the email link cannot farm unlimited codes. A small
   * fixed number (e.g. 5).
   */
  readonly maxReissues: number;
}
