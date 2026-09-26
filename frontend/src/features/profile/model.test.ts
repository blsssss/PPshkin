import { describe, expect, it } from 'vitest';
import { TEST_USER } from '../../../test/http.ts';
import { grantedLine, profilePatch, timeZoneLabel, updatedAgo } from './model.ts';

describe('profilePatch', () => {
  it('keeps only changed fields', () => {
    expect(profilePatch({ kcalTarget: 2000, goal: null, timezone: 'Europe/Moscow' }, TEST_USER)).toEqual({});
    expect(profilePatch({ kcalTarget: 1800, goal: 'gain', timezone: 'Asia/Omsk' }, TEST_USER)).toEqual({
      kcalTarget: 1800,
      goal: 'gain',
      timezone: 'Asia/Omsk',
    });
    expect(
      profilePatch(
        { kcalTarget: 2000, goal: null, timezone: 'Europe/Moscow' },
        { ...TEST_USER, goal: 'lose' },
      ),
    ).toEqual({ goal: null });
  });
});

describe('labels', () => {
  it('names known zones and passes unknown ones through', () => {
    expect(timeZoneLabel('Asia/Yekaterinburg')).toBe('Екатеринбург, UTC+5');
    expect(timeZoneLabel('Europe/Berlin')).toBe('Europe/Berlin');
  });

  it('describes how long ago the location was updated', () => {
    const now = new Date('2026-09-26T12:00:00.000Z');
    expect(updatedAgo('2026-09-26T11:59:40.000Z', now)).toBe('только что');
    expect(updatedAgo('2026-09-26T11:45:00.000Z', now)).toBe('15 минут назад');
    expect(updatedAgo('2026-09-26T09:00:00.000Z', now)).toBe('3 часа назад');
    expect(updatedAgo('2026-09-25T12:00:00.000Z', now)).toBe('вчера');
    expect(updatedAgo('2026-09-26T12:05:00.000Z', now)).toBe('только что');
  });

  it('describes a granted consent', () => {
    expect(grantedLine('2026-09-25T10:00:00.000Z', '2026-09-25')).toBe(
      'Дано 25.09.2026, редакция 2026-09-25',
    );
    expect(grantedLine(null, null)).toBe('Дано');
  });
});
