import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { fixedClock } from '../../test/clock.ts';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import { CONSENT_DOCUMENTS } from '../domain/consents.ts';
import { TAGS, type Tag } from '../domain/vocabulary.ts';
import * as users from '../repositories/users.ts';
import { createConsentsService } from './consents.ts';
import { createProfileService } from './profile.ts';

const pool = testPool();
const clock = fixedClock('2026-09-25T09:00:00Z');
const consents = createConsentsService({ pool, clock });
const profile = createProfileService({ pool, clock, consents });

beforeEach(async () => {
  await resetDatabase(pool);
  clock.set('2026-09-25T09:00:00Z');
  await users.upsert(pool, { id: 1, firstName: 'Ира', username: 'ira' });
  await users.upsert(pool, { id: 2, firstName: 'Олег', username: null });
  await consents.grant(1, 'personal_data', CONSENT_DOCUMENTS.personal_data.version, 'miniapp');
});

afterAll(async () => {
  await closeTestPool();
});

describe('profile service', () => {
  it('returns the user with the consent status', async () => {
    const { user, consents: status } = await profile.get(1);
    expect(user).toMatchObject({ id: 1, firstName: 'Ира', kcalTarget: 2000 });
    expect(status.personalData.granted).toBe(true);
    expect(status.personalizedOffers.granted).toBe(false);
  });

  it('answers 404 for a missing user', async () => {
    await expect(profile.get(404)).rejects.toMatchObject({ status: 404, code: 'user_not_found' });
    await expect(profile.update(404, { kcalTarget: 1800 })).rejects.toMatchObject({
      status: 404,
      code: 'user_not_found',
    });
    await expect(profile.setLocation(404, { lat: 55.79, lon: 49.12 })).rejects.toMatchObject({
      status: 404,
      code: 'user_not_found',
    });
  });

  it('updates the profile and removes duplicate and unknown disliked tags', async () => {
    const { user, consents: status } = await profile.update(1, {
      kcalTarget: 1800,
      goal: 'lose',
      dislikedTags: ['fish', 'spicy', 'fish', 'unknown' as Tag],
      timezone: 'Asia/Yekaterinburg',
    });
    expect(user).toMatchObject({
      kcalTarget: 1800,
      goal: 'lose',
      dislikedTags: ['fish', 'spicy'],
      timezone: 'Asia/Yekaterinburg',
    });
    expect(status.personalData.granted).toBe(true);
    expect((await users.findById(pool, 1))?.dislikedTags).toEqual(['fish', 'spicy']);
  });

  it('rejects an unknown time zone with 422', async () => {
    await expect(profile.update(1, { timezone: 'Mars/Olympus' })).rejects.toMatchObject({
      status: 422,
      code: 'invalid_timezone',
    });
    expect((await users.findById(pool, 1))?.timezone).toBe('Europe/Moscow');
  });

  it('validates the patch when called without HTTP', async () => {
    await expect(profile.update(1, {})).rejects.toMatchObject({ status: 400, code: 'validation_failed' });
    await expect(profile.update(1, { kcalTarget: 999 })).rejects.toMatchObject({
      status: 400,
      code: 'validation_failed',
      details: [{ path: 'kcalTarget' }],
    });
    await expect(profile.update(1, { timezone: 'x'.repeat(65) })).rejects.toMatchObject({
      status: 400,
      details: [{ path: 'timezone' }],
    });
    await expect(profile.update(1, { dislikedTags: TAGS.slice(0, 21) })).rejects.toMatchObject({
      status: 400,
      details: [{ path: 'dislikedTags' }],
    });
    await expect(profile.update(1, { dislikedTags: TAGS.slice(0, 20) })).resolves.toMatchObject({
      user: { dislikedTags: TAGS.slice(0, 20) },
    });
  });

  it('requires the personal data consent before changing anything', async () => {
    await expect(profile.update(2, { kcalTarget: 1800 })).rejects.toMatchObject({
      status: 403,
      code: 'consent_required',
    });
    await expect(profile.setLocation(2, { lat: 55.79, lon: 49.12 })).rejects.toMatchObject({
      status: 403,
      code: 'consent_required',
    });
    expect(await users.findById(pool, 2)).toMatchObject({ kcalTarget: 2000, location: null });
  });

  it('stores a coarse location and returns what was stored', async () => {
    const saved = await profile.setLocation(1, { lat: 55.796389, lon: 49.108891 });
    expect(saved).toEqual({
      location: { lat: 55.8, lon: 49.11 },
      updatedAt: new Date('2026-09-25T09:00:00Z'),
    });
    expect((await profile.get(1)).user).toMatchObject({
      location: { lat: 55.8, lon: 49.11 },
      locationUpdatedAt: new Date('2026-09-25T09:00:00Z'),
    });
  });

  it('rejects coordinates outside the globe', async () => {
    await expect(profile.setLocation(1, { lat: 91, lon: 200 })).rejects.toMatchObject({
      status: 400,
      details: [{ path: 'lat' }, { path: 'lon' }],
    });
  });

  it('clears the location without consent and for missing users', async () => {
    await profile.setLocation(1, { lat: 55.79, lon: 49.12 });
    await profile.clearLocation(1);
    await profile.clearLocation(1);
    await profile.clearLocation(404);
    expect((await profile.get(1)).user).toMatchObject({ location: null, locationUpdatedAt: null });
  });
});
