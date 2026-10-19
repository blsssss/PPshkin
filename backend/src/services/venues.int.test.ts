import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { fixedClock } from '../../test/clock.ts';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import { BAUMANA, KREMLIN, seedDemoVenue, seedMember, seedUser } from '../../test/venues.ts';
import { createVenuesService, type VenueInput } from './venues.ts';

const pool = testPool();
const clock = fixedClock('2026-09-25T09:00:00Z');
const service = createVenuesService({ pool, clock });

const OWNER = 202;

async function rows<Row extends object>(text: string): Promise<Row[]> {
  return (await pool.query<Row>(text)).rows;
}
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
      ownerId: null,
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
    expect(await service.get({ userId: OWNER })).toEqual(venue);
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

  it('creates the company of the first venue with the caller as its owner', async () => {
    const venue = await service.create(OWNER, input);

    expect(venue).toMatchObject({ ownerId: null, companyId: expect.any(Number) as number });
    expect(
      await rows<{ name: string; verification: string; inn: string | null }>(
        'select name, verification, inn from companies',
      ),
    ).toEqual([{ name: 'Кофейня «Зерно»', verification: 'unverified', inn: null }]);
    expect(await rows('select user_id, role, venue_id from memberships')).toEqual([
      { user_id: OWNER, role: 'owner', venue_id: null },
    ]);
  });

  it('puts the next venue of a single company owner into that company', async () => {
    const first = await service.create(OWNER, input);
    const second = await service.create(OWNER, { ...input, name: 'Вторая' });

    expect(second.companyId).toBe(first.companyId);
    await expect(service.get({ userId: OWNER })).rejects.toMatchObject({
      status: 400,
      code: 'venue_required',
    });
    expect(await service.get({ userId: OWNER, venueId: second.id })).toEqual(second);
    expect(await rows('select id from companies')).toHaveLength(1);
  });

  it('creates a separate company when asked to', async () => {
    const first = await service.create(OWNER, input);
    const second = await service.create(OWNER, { ...input, name: 'Вторая' }, { newCompany: true });
    expect(second.companyId).not.toBe(first.companyId);
  });

  it('asks which company when the owner has several', async () => {
    const first = await service.create(OWNER, input);
    await service.create(OWNER, input, { newCompany: true });

    await expect(service.create(OWNER, { ...input, name: 'Третья' })).rejects.toMatchObject({
      status: 400,
      code: 'company_required',
    });
    const third = await service.create(
      OWNER,
      { ...input, name: 'Третья' },
      { companyId: first.companyId ?? 0 },
    );
    expect(third.companyId).toBe(first.companyId);
  });

  it('refuses a manager, a cashier and a stranger company', async () => {
    const venue = await service.create(OWNER, input);
    const companyId = venue.companyId ?? 0;
    await seedMember(pool, companyId, 303, 'manager');
    await seedMember(pool, companyId, 404, 'cashier');

    for (const user of [303, 404]) {
      await expect(service.create(user, input)).rejects.toMatchObject({
        status: 403,
        code: 'venue_forbidden',
      });
      await expect(service.create(user, input, { companyId })).rejects.toMatchObject({
        code: 'venue_forbidden',
      });
    }
    await seedUser(pool, 505);
    await expect(service.create(505, input, { companyId })).rejects.toMatchObject({
      status: 404,
      code: 'company_not_found',
    });
    expect(await rows('select id from venues')).toHaveLength(1);
  });

  it('lets a staff member start a company of his own only on request', async () => {
    const venue = await service.create(OWNER, input);
    await seedMember(pool, venue.companyId ?? 0, 303, 'cashier');

    const own = await service.create(303, input, { newCompany: true });

    expect(own.companyId).not.toBe(venue.companyId);
  });

  it('keeps a demo owner on the demo venue', async () => {
    await seedDemoVenue(pool, 900001, {}, 505);
    await expect(service.create(505, input)).rejects.toMatchObject({ status: 409, code: 'venue_exists' });
    expect(await rows('select id from companies')).toHaveLength(0);
  });

  it('refuses a blocked account', async () => {
    await pool.query("update users set blocked_at = now(), blocked_reason = 'spam' where id = $1", [OWNER]);
    await expect(service.create(OWNER, input)).rejects.toMatchObject({ status: 403, code: 'user_blocked' });
    expect(await rows('select id from companies')).toHaveLength(0);
  });

  it('puts two parallel first venues of one user into one company', async () => {
    const results = await Promise.all([service.create(OWNER, input), service.create(OWNER, input)]);
    expect(results[0].companyId).toBe(results[1].companyId);
    expect(await rows('select id from companies')).toHaveLength(1);
  });

  it('works with the demo venue of the demo owner as before', async () => {
    await seedDemoVenue(pool, 900001, { name: 'Демо' }, -1002);
    expect(await service.get({ userId: -1002 })).toMatchObject({ id: 900001, name: 'Демо' });
    expect(await service.get({ userId: -1002, venueId: 900001 })).toMatchObject({ id: 900001 });
    await expect(service.get({ userId: -1002, venueId: 7 })).rejects.toMatchObject({
      code: 'venue_not_found',
    });
  });

  it('rejects unknown time zones', async () => {
    await expect(service.create(OWNER, { ...input, timezone: 'Mars/Olympus' })).rejects.toMatchObject({
      status: 422,
      code: 'invalid_timezone',
    });
    await service.create(OWNER, input);
    await expect(
      service.update({ userId: OWNER }, { timezone: 'Europe/Kazan' }, 'miniapp'),
    ).rejects.toMatchObject({
      status: 422,
      code: 'invalid_timezone',
    });
  });

  it('reports a missing venue for every owner call', async () => {
    await expect(service.get({ userId: OWNER })).rejects.toMatchObject({
      status: 404,
      code: 'venue_not_found',
    });
    await expect(service.update({ userId: OWNER }, { name: 'Новое' }, 'miniapp')).rejects.toMatchObject({
      status: 404,
      code: 'venue_not_found',
    });
    await expect(
      service.update({ userId: OWNER }, { timezone: 'Mars/Olympus' }, 'miniapp'),
    ).rejects.toMatchObject({
      code: 'venue_not_found',
    });
  });

  it('updates only the given fields and the update time', async () => {
    const created = await service.create(OWNER, input);
    clock.advance(60_000);
    const updated = await service.update(
      { userId: OWNER },
      {
        name: ' Зерно на Кремлёвской ',
        location: KREMLIN,
        closesAt: '23:30',
      },
      'miniapp',
    );
    expect(updated).toEqual({
      ...created,
      name: 'Зерно на Кремлёвской',
      location: KREMLIN,
      closesAt: '23:30',
      updatedAt: clock.now(),
    });
  });
});
