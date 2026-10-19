import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { seedBooking, seedGuest } from '../../test/bookings.ts';
import { fixedClock } from '../../test/clock.ts';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import { recordingNotifications } from '../../test/notifications.ts';
import {
  seedCompany,
  seedCompanyVenue,
  seedDemoVenue,
  seedMember,
  seedMenuItem,
  seedUser,
  seedVenue,
} from '../../test/venues.ts';
import { loadDemoDataset } from '../demo/dataset.ts';
import type { Venue } from '../domain/models.ts';
import { createAnalyticsService } from './analytics.ts';
import { createAuditService } from './audit.ts';
import { createBookingsService } from './bookings.ts';
import { createConsentsService } from './consents.ts';
import { createDealsService } from './deals.ts';
import { createDemoService } from './demo.ts';
import { createMenuService } from './menu.ts';
import { lockVenueAccess, listWorkplaces, resolveVenueAccess } from './access.ts';
import { withTransaction } from '../db/pool.ts';

const dataset = await loadDemoDataset();
const pool = testPool();
const clock = fixedClock('2026-09-25T09:00:00Z');
const OWNER = 101;
const MANAGER = 102;
const CASHIER = 103;
const GUEST = 111;
const HOUR_MS = 3_600_000;

const recorded = recordingNotifications();
const consents = createConsentsService({ pool, clock });
const bookings = createBookingsService({ pool, clock, consents, notifications: recorded.notifications });
const menu = createMenuService({ pool, clock });
const deals = createDealsService({ pool, clock });
const analytics = createAnalyticsService({ pool, clock, bookings });
const audit = createAuditService({ pool });

let companyId: number;
let zerno: Venue;
let kazan: Venue;

beforeEach(async () => {
  await resetDatabase(pool);
  clock.set('2026-09-25T09:00:00Z');
  recorded.clear();
  const company = await seedCompany(pool, OWNER);
  companyId = company.id;
  zerno = await seedCompanyVenue(pool, companyId, { name: 'Зерно' });
  kazan = await seedCompanyVenue(pool, companyId, { name: 'Казань' });
  await seedMember(pool, companyId, MANAGER, 'manager', zerno.id);
  await seedMember(pool, companyId, CASHIER, 'cashier', zerno.id);
});

afterAll(async () => {
  await closeTestPool();
});

describe('resolveVenueAccess', () => {
  it('takes the only workplace without a venue id', async () => {
    const access = await resolveVenueAccess(pool, { userId: CASHIER }, 'venue.view');
    expect(access).toMatchObject({ venue: { id: zerno.id }, role: 'cashier', companyId });
    expect(access.permissions).toEqual(['venue.view', 'booking.redeem']);
  });

  it('asks for a venue id when there are several workplaces', async () => {
    await expect(resolveVenueAccess(pool, { userId: OWNER }, 'venue.view')).rejects.toMatchObject({
      status: 400,
      code: 'venue_required',
    });
    expect(
      (await resolveVenueAccess(pool, { userId: OWNER, venueId: kazan.id }, 'venue.view')).venue.id,
    ).toBe(kazan.id);
  });

  it('answers 404 for a venue of somebody else and for a user without workplaces', async () => {
    const other = await seedCompany(pool, 150);
    const foreign = await seedCompanyVenue(pool, other.id);
    await expect(
      resolveVenueAccess(pool, { userId: OWNER, venueId: foreign.id }, 'venue.view'),
    ).rejects.toMatchObject({ status: 404, code: 'venue_not_found' });
    await expect(
      resolveVenueAccess(pool, { userId: OWNER, venueId: 99_999 }, 'venue.view'),
    ).rejects.toMatchObject({ status: 404, code: 'venue_not_found' });
    await seedUser(pool, 404);
    await expect(resolveVenueAccess(pool, { userId: 404 }, 'venue.view')).rejects.toMatchObject({
      status: 404,
      code: 'venue_not_found',
    });
  });

  it('hides the other venues from a manager with a venue scope', async () => {
    await expect(
      resolveVenueAccess(pool, { userId: MANAGER, venueId: kazan.id }, 'venue.view'),
    ).rejects.toMatchObject({ status: 404, code: 'venue_not_found' });
    expect((await listWorkplaces(pool, MANAGER)).map(({ venue }) => venue.id)).toEqual([zerno.id]);
  });

  it('gives a member without a venue scope every venue of the company', async () => {
    await seedMember(pool, companyId, 104, 'manager');
    expect((await listWorkplaces(pool, 104)).map(({ venue }) => venue.id)).toEqual([zerno.id, kazan.id]);
  });

  it('refuses a role without the permission with 403', async () => {
    await expect(resolveVenueAccess(pool, { userId: CASHIER }, 'menu.edit')).rejects.toMatchObject({
      status: 403,
      code: 'venue_forbidden',
    });
    await expect(resolveVenueAccess(pool, { userId: MANAGER }, 'venue.create')).rejects.toMatchObject({
      status: 403,
    });
    await expect(resolveVenueAccess(pool, { userId: MANAGER }, 'menu.edit')).resolves.toBeDefined();
  });

  it('works with the demo venue of the demo owner as before', async () => {
    await seedDemoVenue(pool, 900001, { name: 'Демо' }, -1002);
    const access = await resolveVenueAccess(pool, { userId: -1002 }, 'menu.edit');
    expect(access).toMatchObject({ venue: { id: 900001 }, role: 'owner', companyId: null });
    expect((await listWorkplaces(pool, -1002))[0]).toMatchObject({ company: null, venueScoped: false });
  });

  it('works with a venue that still belongs to its owner id', async () => {
    const legacy = await seedVenue(pool, 200);
    expect((await resolveVenueAccess(pool, { userId: 200 }, 'analytics.view')).venue.id).toBe(legacy.id);
  });

  it('follows the membership on the next call', async () => {
    await resolveVenueAccess(pool, { userId: CASHIER }, 'venue.view');
    await pool.query('delete from memberships where user_id = $1', [CASHIER]);
    await expect(resolveVenueAccess(pool, { userId: CASHIER }, 'venue.view')).rejects.toMatchObject({
      code: 'venue_not_found',
    });
  });

  it('locks the venue row for the caller of lockVenueAccess', async () => {
    const access = await withTransaction(pool, (client) =>
      lockVenueAccess(client, { userId: MANAGER }, 'menu.edit'),
    );
    expect(access.venue.id).toBe(zerno.id);
    await expect(
      withTransaction(pool, (client) => lockVenueAccess(client, { userId: CASHIER }, 'menu.edit')),
    ).rejects.toMatchObject({ code: 'venue_forbidden' });
  });
});

describe('services behind the roles', () => {
  const eclair = {
    name: 'Эклер',
    description: null,
    category: 'dessert' as const,
    priceRub: 200,
    weightG: 80,
    kcal: 330,
    proteinG: 5,
    fatG: 18,
    carbsG: 38,
    tags: [],
    isAvailable: true,
  };

  it('lets a cashier read the menu and the deals but not change them', async () => {
    const actor = { userId: CASHIER };
    const item = await seedMenuItem(pool, zerno.id);
    expect(await menu.list(actor)).toHaveLength(1);
    expect(await deals.list(actor, 'active')).toEqual([]);

    await expect(menu.create(actor, eclair, 'miniapp')).rejects.toMatchObject({
      status: 403,
      code: 'venue_forbidden',
    });
    await expect(menu.archive(actor, item.id, 'miniapp')).rejects.toMatchObject({ status: 403 });
    await expect(
      deals.create(
        actor,
        { menuItemId: item.id, priceRub: 100, quantity: 2, endsAt: new Date(Date.now() + HOUR_MS) },
        'miniapp',
      ),
    ).rejects.toMatchObject({ status: 403, code: 'venue_forbidden' });
    await expect(analytics.get(actor, {})).rejects.toMatchObject({ status: 403 });
    await expect(audit.list(actor, {})).rejects.toMatchObject({ status: 403 });
  });

  it('lets a manager edit the own venue and see its audit, and nothing of the other venue', async () => {
    const actor = { userId: MANAGER };
    const created = await menu.create(actor, eclair, 'bot');
    expect(created.venueId).toBe(zerno.id);

    const page = await audit.list(actor, {});
    expect(page.items.map(({ action, actor: who }) => [action, who?.userId, who?.role])).toEqual([
      ['menu_item.create', MANAGER, 'manager'],
    ]);
    await expect(menu.list({ userId: MANAGER, venueId: kazan.id })).rejects.toMatchObject({ status: 404 });
    expect(await menu.list({ userId: OWNER, venueId: kazan.id })).toEqual([]);
  });

  it('shows the owner the actors of the log with their roles and keeps old authors visible', async () => {
    await menu.create({ userId: MANAGER }, eclair, 'bot');
    await menu.create({ userId: OWNER, venueId: zerno.id }, { ...eclair, name: 'Морс' }, 'miniapp');
    await pool.query('delete from memberships where user_id = $1', [MANAGER]);

    const page = await audit.list({ userId: OWNER, venueId: zerno.id }, {});

    expect(page.items.map(({ actor: who }) => [who?.userId, who?.role])).toEqual([
      [OWNER, 'owner'],
      [MANAGER, 'cashier'],
    ]);
  });

  it('records the cashier who redeemed a booking', async () => {
    await seedGuest(pool, GUEST, clock.now());
    const item = await seedMenuItem(pool, zerno.id);
    const id = await seedBooking(pool, { userId: GUEST, item, code: 'K7M2QX', createdAt: clock.now() });

    const view = await bookings.redeem({ userId: CASHIER }, 'k7m2qx', 'bot');

    expect(view.booking).toMatchObject({ id, status: 'redeemed' });
    const { rows } = await pool.query<{ redeemed_by: number }>(
      'select redeemed_by from bookings where id = $1',
      [id],
    );
    expect(rows).toEqual([{ redeemed_by: CASHIER }]);
    const page = await audit.list({ userId: OWNER, venueId: zerno.id }, {});
    expect(page.items[0]).toMatchObject({
      action: 'booking.redeem',
      actor: { userId: CASHIER, role: 'cashier' },
    });
  });

  it('lets a cashier redeem only in the venue of the scope', async () => {
    await seedGuest(pool, GUEST, clock.now());
    const item = await seedMenuItem(pool, kazan.id);
    await seedBooking(pool, { userId: GUEST, item, code: 'K7M2QX', createdAt: clock.now() });

    await expect(
      bookings.redeem({ userId: CASHIER, venueId: kazan.id }, 'K7M2QX', 'bot'),
    ).rejects.toMatchObject({
      status: 404,
      code: 'venue_not_found',
    });
    await expect(bookings.redeem({ userId: CASHIER }, 'K7M2QX', 'bot')).rejects.toMatchObject({
      code: 'booking_not_found',
    });
    expect((await bookings.listForVenue({ userId: CASHIER }, { status: 'active' })).length).toBe(0);
  });
});

describe('claiming the demo venue', () => {
  it('answers 409 venue_exists to a staff member of a company', async () => {
    const demo = createDemoService({ pool, clock, consents, dataset });
    await demo.seed();

    await expect(demo.claimVenue(CASHIER)).rejects.toMatchObject({ status: 409, code: 'venue_exists' });
    await expect(demo.claimVenue(OWNER)).rejects.toMatchObject({ status: 409, code: 'venue_exists' });
    expect((await listWorkplaces(pool, CASHIER)).map(({ venue }) => venue.id)).toEqual([zerno.id]);
  });

  it('still gives a free user a copy that opens as his workplace', async () => {
    const demo = createDemoService({ pool, clock, consents, dataset });
    await demo.seed();
    await seedUser(pool, 404);

    const copy = await demo.claimVenue(404);

    expect((await resolveVenueAccess(pool, { userId: 404 }, 'menu.edit')).venue.id).toBe(copy.id);
  });
});
