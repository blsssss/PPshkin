import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { fixedClock } from '../../test/clock.ts';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import { BAUMANA, KREMLIN, seedUser } from '../../test/venues.ts';
import { createVenuesService, type VenueInput } from './venues.ts';

const pool = testPool();
const clock = fixedClock('2026-09-25T09:00:00Z');
const service = createVenuesService({ pool, clock });

const OWNER = 202;
const input: VenueInput = {
  name: '  Кофейня «Зерно» ',
  address: 'ул. Баумана, 36',
  category: 'coffee',
  location: BAUMANA,
};

beforeEach(async () => {
  await resetDatabase(pool);
  clock.set('2026-09-25T09:00:00Z');
  await seedUser(pool, OWNER);
});

afterAll(async () => {
  await closeTestPool();
});

describe('venues service', () => {
  it('creates a venue with default hours and time zone', async () => {
    const venue = await service.create(OWNER, input);
    expect(venue).toMatchObject({
      ownerId: OWNER,
      name: 'Кофейня «Зерно»',
      address: 'ул. Баумана, 36',
      category: 'coffee',
      location: BAUMANA,
      opensAt: '08:00',
      closesAt: '22:00',
      timezone: 'Europe/Moscow',
      isDemo: false,
      createdAt: clock.now(),
    });
    expect(await service.get(OWNER)).toEqual(venue);
  });

  it('keeps exact coordinates and hours that end after midnight', async () => {
    const precise = { lat: 55.788712, lon: 49.122134 };
    const venue = await service.create(OWNER, {
      ...input,
      location: precise,
      opensAt: '20:00',
      closesAt: '02:00',
      timezone: 'Europe/Samara',
    });
    expect(venue).toMatchObject({
      location: precise,
      opensAt: '20:00',
      closesAt: '02:00',
      timezone: 'Europe/Samara',
    });
  });

  it('allows only one venue per owner', async () => {
    await service.create(OWNER, input);
    await expect(service.create(OWNER, { ...input, name: 'Вторая' })).rejects.toMatchObject({
      status: 409,
      code: 'venue_exists',
    });
  });

  it('keeps one venue when an owner creates two at once', async () => {
    const results = await Promise.allSettled([service.create(OWNER, input), service.create(OWNER, input)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { code: 'venue_exists' },
    });
  });

  it('rejects unknown time zones', async () => {
    await expect(service.create(OWNER, { ...input, timezone: 'Mars/Olympus' })).rejects.toMatchObject({
      status: 422,
      code: 'invalid_timezone',
    });
    await service.create(OWNER, input);
    await expect(service.update(OWNER, { timezone: 'Europe/Kazan' })).rejects.toMatchObject({
      status: 422,
      code: 'invalid_timezone',
    });
  });

  it('reports a missing venue for every owner call', async () => {
    await expect(service.get(OWNER)).rejects.toMatchObject({ status: 404, code: 'venue_not_found' });
    await expect(service.update(OWNER, { name: 'Новое' })).rejects.toMatchObject({
      status: 404,
      code: 'venue_not_found',
    });
    await expect(service.update(OWNER, { timezone: 'Mars/Olympus' })).rejects.toMatchObject({
      code: 'venue_not_found',
    });
  });

  it('updates only the given fields and the update time', async () => {
    const created = await service.create(OWNER, input);
    clock.advance(60_000);
    const updated = await service.update(OWNER, {
      name: ' Зерно на Кремлёвской ',
      location: KREMLIN,
      closesAt: '23:30',
    });
    expect(updated).toEqual({
      ...created,
      name: 'Зерно на Кремлёвской',
      location: KREMLIN,
      closesAt: '23:30',
      updatedAt: clock.now(),
    });
  });
});
