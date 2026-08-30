// One-time release codes: 72-hour expiry (DECISIONS.md 4.2), single-value match.

import { constantTimeEquals, issueCode, isCodeValid } from '../../src/delivery/codes';
import { CODE_EXPIRY_HOURS, HOUR_MS } from '../../src/domain/config';

const T = 1_700_000_000_000;

describe('one-time codes', () => {
  it('expires exactly 72 hours after issue', () => {
    const code = issueCode('482913', T);
    expect(code.expiresAt).toBe(T + CODE_EXPIRY_HOURS * HOUR_MS);
  });

  it('validates the right value within the window', () => {
    const code = issueCode('482913', T);
    expect(isCodeValid(code, '482913', T + HOUR_MS)).toBe(true);
  });

  it('rejects the wrong value', () => {
    const code = issueCode('482913', T);
    expect(isCodeValid(code, '000000', T + HOUR_MS)).toBe(false);
  });

  it('rejects a value once the code has expired', () => {
    const code = issueCode('482913', T);
    expect(isCodeValid(code, '482913', T + CODE_EXPIRY_HOURS * HOUR_MS)).toBe(false);
    expect(isCodeValid(code, '482913', T + CODE_EXPIRY_HOURS * HOUR_MS + 1)).toBe(false);
  });
});

describe('constantTimeEquals (F4 — constant-time code verification)', () => {
  it('is true only for an exact match', () => {
    expect(constantTimeEquals('482913', '482913')).toBe(true);
    expect(constantTimeEquals('482913', '482914')).toBe(false);
  });

  it('is false for differing lengths without throwing', () => {
    expect(constantTimeEquals('482913', '48291')).toBe(false);
    expect(constantTimeEquals('', '0')).toBe(false);
    expect(constantTimeEquals('', '')).toBe(true);
  });
});
