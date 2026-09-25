import { describe, expect, it } from 'vitest';
import { maxUserJson, signInitData } from '../../test/init-data.ts';
import { InitDataError, verifyInitData, type InitDataFailure } from './init-data.ts';

const BOT_TOKEN = 'test-bot-token-0123456789';
const NOW = new Date('2026-09-25T12:00:00Z');
const AUTH_DATE = String(Math.floor(NOW.getTime() / 1000) - 60);

const options = { botToken: BOT_TOKEN, maxAgeSeconds: 3600, now: NOW };

function signed(fields: Record<string, string> = {}) {
  return signInitData(
    { auth_date: AUTH_DATE, query_id: 'q-1', user: maxUserJson(396272693), ...fields },
    BOT_TOKEN,
  );
}

function failure(raw: string, verifyOptions = options): InitDataFailure | null {
  try {
    verifyInitData(raw, verifyOptions);
    return null;
  } catch (error) {
    expect(error).toBeInstanceOf(InitDataError);
    return (error as InitDataError).reason;
  }
}

describe('verifyInitData', () => {
  it('accepts correctly signed data and extracts the user', () => {
    const verified = verifyInitData(signed({ start_param: 'venue_42' }), options);
    expect(verified.user).toEqual({
      id: 396272693,
      firstName: 'Анна',
      lastName: null,
      username: null,
      languageCode: 'ru',
    });
    expect(verified.startParam).toBe('venue_42');
    expect(verified.queryId).toBe('q-1');
    expect(verified.authDate.toISOString()).toBe('2026-09-25T11:59:00.000Z');
  });

  it('keeps values that contain an equals sign', () => {
    const raw = signed({ user: maxUserJson(5, 'Пётр', { photo_url: 'https://i.example/p?size=64&x=1' }) });
    expect(verifyInitData(raw, options).user.id).toBe(5);
  });

  it('handles names with spaces', () => {
    const raw = signed({ user: maxUserJson(6, 'Анна Мария') });
    expect(verifyInitData(raw, options).user.firstName).toBe('Анна Мария');
  });

  it('rejects data signed with another token', () => {
    const raw = signInitData({ auth_date: AUTH_DATE, user: maxUserJson(1) }, 'another-bot-token-000000');
    expect(failure(raw)).toBe('bad_signature');
  });

  it('rejects tampered fields', () => {
    const raw = signed().replace('396272693', '396272694');
    expect(failure(raw)).toBe('bad_signature');
  });

  it('rejects stale data', () => {
    const stale = String(Math.floor(NOW.getTime() / 1000) - 3601);
    expect(failure(signed({ auth_date: stale }))).toBe('expired');
  });

  it('rejects data from the future beyond clock skew', () => {
    const future = String(Math.floor(NOW.getTime() / 1000) + 120);
    expect(failure(signed({ auth_date: future }))).toBe('expired');
  });

  it('rejects duplicated keys', () => {
    expect(failure(`${signed()}&auth_date=${AUTH_DATE}`)).toBe('malformed');
  });

  it('rejects a missing or malformed hash', () => {
    expect(failure(`auth_date=${AUTH_DATE}`)).toBe('malformed');
    expect(failure(`auth_date=${AUTH_DATE}&hash=xyz`)).toBe('malformed');
  });

  it('rejects broken percent encoding', () => {
    expect(failure(`user=%E0%A4%A&auth_date=${AUTH_DATE}&hash=${'a'.repeat(64)}`)).toBe('malformed');
  });

  it('requires a user with a numeric id', () => {
    expect(failure(signInitData({ auth_date: AUTH_DATE }, BOT_TOKEN))).toBe('no_user');
    expect(failure(signed({ user: JSON.stringify({ id: 'x' }) }))).toBe('no_user');
    expect(failure(signed({ user: '{not json' }))).toBe('malformed');
  });

  it('requires a numeric auth date', () => {
    expect(failure(signed({ auth_date: 'yesterday' }))).toBe('malformed');
  });
});
