import { memoryPhotoStorage } from '../../test/photo-storage.ts';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { seedGuest } from '../../test/bookings.ts';
import { fixedClock } from '../../test/clock.ts';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import { recordingNotifications } from '../../test/notifications.ts';
import { seedMenuItem, seedVenue } from '../../test/venues.ts';
import type { MenuItem, Venue } from '../domain/models.ts';
import type { MenuParser } from '../ports/recognition.ts';
import * as audit from '../repositories/audit.ts';
import { createBackgroundTasks } from '../shared/background.ts';
import { createAuditService } from './audit.ts';
import { createBookingsService } from './bookings.ts';
import { createConsentsService } from './consents.ts';
import { createDealsService } from './deals.ts';
import { createMenuImportsService } from './menu-imports.ts';
import { createMenuService } from './menu.ts';
import { createVenuesService } from './venues.ts';

const pool = testPool();
const clock = fixedClock('2026-09-25T09:00:00Z');
const OWNER = 202;
const OTHER_OWNER = 303;
const GUEST = 101;
const HOUR = 3_600_000;

const notifications = recordingNotifications().notifications;
const consents = createConsentsService({ pool, clock });
const bookings = createBookingsService({ pool, clock, consents, notifications });
const deals = createDealsService({ pool, clock });
const menu = createMenuService({ pool, clock, storage: memoryPhotoStorage() });
const venues = createVenuesService({ pool, clock });
const menus: MenuParser = {
  fromPhoto: () => Promise.reject(new Error('photos are not used here')),
  fromText: () =>
    Promise.resolve({
      status: 'parsed',
      venueName: null,
      items: [
        {
          name: 'Эклер',
          description: null,
          category: 'dessert',
          priceRub: 200,
          weightG: 80,
          kcal: 330,
          proteinG: 5,
          fatG: 18,
          carbsG: 38,
          tags: [],
        },
        {
          name: 'Морс',
          description: null,
          category: 'drink',
          priceRub: 90,
          weightG: 250,
          kcal: 90,
          proteinG: 0,
          fatG: 0,
          carbsG: 22,
          tags: [],
        },
      ],
      model: 'test',
    }),
};
const background = createBackgroundTasks({ error: () => undefined });
const menuImports = createMenuImportsService({ pool, clock, menus, background, notifications });
const service = createAuditService({ pool });

let venue: Venue;
let eclair: MenuItem;

async function events() {
  const { rows } = await pool.query<{
    action: string;
    actor_user_id: number | null;
    target_type: string;
    target_id: number | null;
    details: Record<string, unknown>;
  }>('select action, actor_user_id, target_type, target_id, details from audit_events order by id');
  return rows;
}

beforeEach(async () => {
  await background.idle();
  await resetDatabase(pool);
  clock.set('2026-09-25T09:00:00Z');
  venue = await seedVenue(pool, OWNER);
  eclair = await seedMenuItem(pool, venue.id, { name: 'Эклер', priceRub: 200 });
});

afterAll(async () => {
  await background.idle();
  await closeTestPool();
});

describe('venue audit log', () => {
  it('records a redeemed booking with the code and the price, without guest data', async () => {
    await seedGuest(pool, GUEST, clock.now());
    const { booking } = await bookings.create(GUEST, { menuItemId: eclair.id }, 'miniapp');

    await bookings.redeem({ userId: OWNER }, booking.code, 'bot');

    expect(await events()).toEqual([
      {
        action: 'booking.redeem',
        actor_user_id: OWNER,
        target_type: 'booking',
        target_id: booking.id,
        details: { code: booking.code, priceRub: 200, channel: 'bot' },
      },
    ]);
    expect(JSON.stringify(await events())).not.toContain(String(GUEST));
  });

  it('records publishing, changing and stopping a hot deal', async () => {
    const endsAt = new Date(clock.now().getTime() + 2 * HOUR);
    const { deal } = await deals.create(
      { userId: OWNER },
      { menuItemId: eclair.id, priceRub: 120, quantity: 5, endsAt },
      'miniapp',
    );
    await deals.update({ userId: OWNER }, deal.id, { quantityLeft: 3 }, 'miniapp');
    await deals.cancel({ userId: OWNER }, deal.id, 'bot');
    await deals.cancel({ userId: OWNER }, deal.id, 'bot');

    expect(await events()).toEqual([
      {
        action: 'deal.create',
        actor_user_id: OWNER,
        target_type: 'deal',
        target_id: deal.id,
        details: {
          item: 'Эклер',
          priceRub: 120,
          quantity: 5,
          endsAt: endsAt.toISOString(),
          channel: 'miniapp',
        },
      },
      {
        action: 'deal.update',
        actor_user_id: OWNER,
        target_type: 'deal',
        target_id: deal.id,
        details: { item: 'Эклер', priceRub: 120, changes: { quantityLeft: 3 }, channel: 'miniapp' },
      },
      {
        action: 'deal.cancel',
        actor_user_id: OWNER,
        target_type: 'deal',
        target_id: deal.id,
        details: {
          item: 'Эклер',
          priceRub: 120,
          quantityLeft: 3,
          endsAt: endsAt.toISOString(),
          channel: 'bot',
        },
      },
    ]);
  });

  it('records the stopped deals when a menu item with a live deal is archived', async () => {
    const endsAt = new Date(clock.now().getTime() + 2 * HOUR);
    const { deal } = await deals.create(
      { userId: OWNER },
      { menuItemId: eclair.id, priceRub: 120, quantity: 5, endsAt },
      'miniapp',
    );
    await menu.archive({ userId: OWNER }, eclair.id, 'bot');

    expect((await events()).slice(1)).toEqual([
      {
        action: 'deal.cancel',
        actor_user_id: OWNER,
        target_type: 'deal',
        target_id: deal.id,
        details: {
          item: 'Эклер',
          priceRub: 120,
          quantityLeft: 5,
          endsAt: endsAt.toISOString(),
          channel: 'bot',
        },
      },
      {
        action: 'menu_item.archive',
        actor_user_id: OWNER,
        target_type: 'menu_item',
        target_id: eclair.id,
        details: { name: 'Эклер', channel: 'bot' },
      },
    ]);
  });

  it('records menu items, an applied import and venue changes with the changed fields', async () => {
    const tart = await menu.create(
      { userId: OWNER },
      { name: 'Тарт', category: 'dessert', priceRub: 250, kcal: 400, tags: [], isAvailable: true },
      'miniapp',
    );
    await menu.update({ userId: OWNER }, tart.id, { priceRub: 270, isAvailable: false }, 'miniapp');
    await menu.update({ userId: OWNER }, tart.id, { description: 'С ягодами' }, 'bot');
    await menu.archive({ userId: OWNER }, tart.id, 'miniapp');
    const started = await menuImports.fromText({ userId: OWNER }, 'Эклер 200 ₽\nМорс 90 ₽');
    await background.idle();
    const parsed = await menuImports.get({ userId: OWNER }, started.id);
    await menuImports.apply(
      { userId: OWNER },
      started.id,
      parsed.items.map((item) => ({ ...item, priceRub: item.priceRub ?? 1 })),
      'bot',
    );
    await venues.update({ userId: OWNER }, { closesAt: '23:00', name: 'Зерно' }, 'miniapp');

    expect(
      (await events()).map(({ action, target_type, details }) => [action, target_type, details]),
    ).toEqual([
      ['menu_item.create', 'menu_item', { name: 'Тарт', priceRub: 250, channel: 'miniapp' }],
      [
        'menu_item.update',
        'menu_item',
        { fields: ['isAvailable', 'priceRub'], priceRub: 270, channel: 'miniapp' },
      ],
      ['menu_item.update', 'menu_item', { fields: ['description'], channel: 'bot' }],
      ['menu_item.archive', 'menu_item', { name: 'Тарт', channel: 'miniapp' }],
      ['menu_import.apply', 'menu_import', { added: 1, duplicates: 1, channel: 'bot' }],
      ['venue.update', 'venue', { fields: ['closesAt', 'name'], channel: 'miniapp' }],
    ]);
  });

  it('rolls the action back when the record cannot be written', async () => {
    await pool.query(`alter table audit_events add constraint no_deals check (action <> 'deal.create')`);
    try {
      await expect(
        deals.create(
          { userId: OWNER },
          {
            menuItemId: eclair.id,
            priceRub: 120,
            quantity: 5,
            endsAt: new Date(clock.now().getTime() + HOUR),
          },
          'bot',
        ),
      ).rejects.toThrow();
      const { rows } = await pool.query('select id from deals');
      expect(rows).toEqual([]);
    } finally {
      await pool.query('alter table audit_events drop constraint no_deals');
    }
  });

  it('writes nothing when the action itself fails', async () => {
    const { deal } = await deals.create(
      { userId: OWNER },
      { menuItemId: eclair.id, priceRub: 120, quantity: 5, endsAt: new Date(clock.now().getTime() + HOUR) },
      'bot',
    );
    await expect(deals.update({ userId: OWNER }, deal.id, { quantityLeft: 50 }, 'bot')).rejects.toMatchObject(
      {
        code: 'deal_quantity_invalid',
      },
    );
    expect((await events()).map((event) => event.action)).toEqual(['deal.create']);
  });
});

describe('reading the audit log', () => {
  async function fill(count: number, start: Date) {
    for (let index = 0; index < count; index += 1) {
      await audit.record(
        pool,
        {
          venueId: venue.id,
          actorUserId: OWNER,
          action: 'venue.update',
          target: { type: 'venue', id: venue.id },
          channel: 'miniapp',
          details: { fields: ['name'] },
        },
        new Date(start.getTime() + index * 60_000),
      );
    }
  }

  it('pages 100 records at a time, newest first', async () => {
    await fill(105, new Date('2026-09-20T09:00:00Z'));

    const first = await service.list({ userId: OWNER }, {});
    expect(first.items).toHaveLength(100);
    expect(first.items[0]).toMatchObject({
      action: 'venue.update',
      actor: { userId: OWNER, name: null, role: 'owner' },
      target: { type: 'venue', id: venue.id },
      details: { fields: ['name'], channel: 'miniapp' },
      createdAt: new Date(new Date('2026-09-20T09:00:00Z').getTime() + 104 * 60_000),
    });
    expect(first.nextCursor).toBe(String(first.items.at(-1)?.id));

    const second = await service.list({ userId: OWNER }, { cursor: first.nextCursor ?? '' });
    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(105);
  });

  it('filters by local days of the venue and shows only its own records', async () => {
    await fill(1, new Date('2026-09-20T20:59:00Z'));
    await fill(1, new Date('2026-09-20T21:00:00Z'));
    await seedVenue(pool, OTHER_OWNER);

    expect(
      (await service.list({ userId: OWNER }, { from: '2026-09-21', to: '2026-09-21' })).items,
    ).toHaveLength(1);
    expect(
      (await service.list({ userId: OWNER }, { from: '2026-09-20', to: '2026-09-20' })).items,
    ).toHaveLength(1);
    expect((await service.list({ userId: OTHER_OWNER }, {})).items).toEqual([]);
    await expect(service.list({ userId: 999 }, {})).rejects.toMatchObject({
      status: 404,
      code: 'venue_not_found',
    });
    await expect(
      service.list({ userId: OWNER }, { from: '2026-09-22', to: '2026-09-21' }),
    ).rejects.toMatchObject({
      status: 400,
      code: 'validation_failed',
    });
  });

  it('keeps the record of a deleted actor without the actor', async () => {
    await fill(1, clock.now());
    await pool.query('update audit_events set actor_user_id = null');
    expect((await service.list({ userId: OWNER }, {})).items[0]?.actor).toBeNull();
  });
});
