import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { fixedClock } from '../../test/clock.ts';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import { seedCompany, seedCompanyVenue, seedMember, seedUser, seedVenue } from '../../test/venues.ts';
import { createNotificationSettingsService } from './notification-settings.ts';

const pool = testPool();
const clock = fixedClock('2026-09-25T09:00:00Z');
const service = createNotificationSettingsService({ pool, clock });
const GUEST = 101;
const OWNER = 202;

beforeEach(async () => {
  await resetDatabase(pool);
  await seedUser(pool, GUEST);
});

afterAll(async () => {
  await closeTestPool();
});

describe('notification settings', () => {
  it('gives a guest without a row everything on and quiet hours 22:00-09:00 in the guest time zone', async () => {
    await pool.query(`update users set timezone = 'Asia/Yekaterinburg' where id = $1`, [GUEST]);

    expect(await service.get(GUEST)).toEqual({
      timezone: 'Asia/Yekaterinburg',
      quietHours: { from: '22:00', until: '09:00' },
      kinds: ['booking_confirmed', 'booking_reminder', 'booking_redeemed', 'booking_expired'].map((kind) => ({
        kind,
        audience: 'guest',
        enabled: true,
        editable: true,
      })),
    });
  });

  it('adds the venue kinds for the staff of a company as well', async () => {
    const company = await seedCompany(pool, OWNER);
    await seedCompanyVenue(pool, company.id);
    await seedMember(pool, company.id, 303, 'cashier');

    for (const user of [OWNER, 303]) {
      const { kinds } = await service.get(user);
      expect(kinds.some(({ audience }) => audience === 'venue')).toBe(true);
    }
    await expect(
      service.update(303, { kinds: [{ kind: 'venue_booking_created', enabled: false }] }),
    ).resolves.toBeDefined();
  });

  it('adds the venue kinds for an owner with the menu import result always on', async () => {
    await seedVenue(pool, OWNER);

    const { kinds } = await service.get(OWNER);

    expect(kinds.filter(({ audience }) => audience === 'venue').map(({ kind }) => kind)).toEqual([
      'venue_booking_created',
      'venue_booking_cancelled',
      'venue_booking_expired',
      'venue_deal_sold_out',
      'venue_deal_ending',
      'menu_import_done',
      'venue_report_ready',
    ]);
    expect(kinds.find(({ kind }) => kind === 'menu_import_done')).toEqual({
      kind: 'menu_import_done',
      audience: 'venue',
      enabled: true,
      editable: false,
    });
  });

  it('keeps the changes and changes only what is sent', async () => {
    await service.update(GUEST, { kinds: [{ kind: 'booking_reminder', enabled: false }] });
    const changed = await service.update(GUEST, { quietHours: { from: '23:30', until: '07:00' } });

    expect(changed.quietHours).toEqual({ from: '23:30', until: '07:00' });
    expect(changed.kinds.find(({ kind }) => kind === 'booking_reminder')?.enabled).toBe(false);
    expect(await service.get(GUEST)).toEqual(changed);

    const back = await service.update(GUEST, {
      quietHours: null,
      kinds: [{ kind: 'booking_reminder', enabled: true }],
    });
    expect(back.quietHours).toBeNull();
    expect(back.kinds.every(({ enabled }) => enabled)).toBe(true);
    const { rows } = await pool.query(
      'select quiet_from, quiet_until, disabled_kinds from notification_settings',
    );
    expect(rows).toEqual([{ quiet_from: null, quiet_until: null, disabled_kinds: [] }]);
  });

  it('refuses to turn off the menu import result or a venue kind without a venue', async () => {
    await expect(
      service.update(GUEST, { kinds: [{ kind: 'venue_booking_created', enabled: false }] }),
    ).rejects.toMatchObject({ status: 422, code: 'notification_not_editable' });
    await seedVenue(pool, OWNER);
    await expect(
      service.update(OWNER, { kinds: [{ kind: 'menu_import_done', enabled: false }] }),
    ).rejects.toMatchObject({ status: 422, code: 'notification_not_editable' });
    const { rows } = await pool.query('select user_id from notification_settings');
    expect(rows).toEqual([]);
  });

  it('lets demo accounts change their settings and answers 404 for a missing user', async () => {
    await seedUser(pool, -1001);
    expect((await service.update(-1001, { quietHours: null })).quietHours).toBeNull();
    await expect(service.get(999)).rejects.toMatchObject({ status: 404, code: 'user_not_found' });
    await expect(service.update(999, { quietHours: null })).rejects.toMatchObject({
      status: 404,
      code: 'user_not_found',
    });
  });

  it('deletes the settings together with the account', async () => {
    await service.update(GUEST, { quietHours: null });
    await pool.query('delete from users where id = $1', [GUEST]);
    const { rows } = await pool.query('select user_id from notification_settings');
    expect(rows).toEqual([]);
  });
});
