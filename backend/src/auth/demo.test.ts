import { describe, expect, it } from 'vitest';
import { DEMO_ACCOUNTS, matchDemoToken } from './demo.ts';

const tokens = { guest: 'guest-demo-token-0123456789', venue: 'venue-demo-token-0123456789' };

describe('matchDemoToken', () => {
  it('maps configured tokens to roles', () => {
    expect(matchDemoToken(tokens.guest, tokens)).toBe('guest');
    expect(matchDemoToken(tokens.venue, tokens)).toBe('venue');
  });

  it('uses ids that MAX never issues', () => {
    for (const account of Object.values(DEMO_ACCOUNTS)) {
      expect(account.userId).toBeLessThan(0);
    }
  });

  it('rejects unknown tokens and unconfigured roles', () => {
    expect(matchDemoToken('guest-demo-token-012345678X', tokens)).toBeNull();
    expect(matchDemoToken('anything', {})).toBeNull();
    expect(matchDemoToken('', { guest: undefined })).toBeNull();
  });
});
