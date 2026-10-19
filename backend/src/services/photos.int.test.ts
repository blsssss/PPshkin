import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { fixedClock } from '../../test/clock.ts';
import { closeTestPool, resetDatabase, testPool } from '../../test/database.ts';
import { testImage } from '../../test/images.ts';
import { memoryPhotoStorage } from '../../test/photo-storage.ts';
import { seedCompany, seedCompanyVenue, seedMember, seedMenuItem, seedVenue } from '../../test/venues.ts';
import type { MenuItem, Venue } from '../domain/models.ts';
import { MAX_PHOTO_BYTES } from '../photos/process.ts';
import { createAuditService } from './audit.ts';
import { createMenuService } from './menu.ts';
import { createPhotosService } from './photos.ts';

const pool = testPool();
const clock = fixedClock('2026-09-25T09:00:00Z');
const storage = memoryPhotoStorage();
const service = createPhotosService({ pool, clock, storage });
const menu = createMenuService({ pool, clock, storage });
const audit = createAuditService({ pool });

const OWNER = 101;
const MANAGER = 102;
const CASHIER = 103;
const STRANGER = 104;

let venue: Venue;
let item: MenuItem;
let secondItem: MenuItem;

beforeEach(async () => {
  await resetDatabase(pool);
  for (const key of storage.keys()) await storage.remove(key);
  clock.set('2026-09-25T09:00:00Z');
  const company = await seedCompany(pool, OWNER);
  venue = await seedCompanyVenue(pool, company.id);
  await seedMember(pool, company.id, MANAGER, 'manager', venue.id);
  await seedMember(pool, company.id, CASHIER, 'cashier', venue.id);
  item = await seedMenuItem(pool, venue.id, { name: 'Эклер' });
  secondItem = await seedMenuItem(pool, venue.id, { name: 'Капучино', category: 'drink' });
});

afterAll(async () => {
  await closeTestPool();
});

const orange = () => testImage('jpeg', { color: '#c8793a' });
const blue = () => testImage('png', { color: '#3a79c8' });

describe('venue photo', () => {
  it('stores the processed photo and exposes its key', async () => {
    const updated = await service.setVenuePhoto({ userId: OWNER }, await orange(), 'miniapp');
    expect(updated.photoKey).toMatch(/^[0-9a-f]{64}$/);
    expect(storage.keys()).toEqual([updated.photoKey]);
    expect(await service.read(updated.photoKey ?? '', 'card')).not.toBeNull();
    expect(await service.read(updated.photoKey ?? '', 'large')).not.toBeNull();
  });

  it('lets a manager upload and keeps a cashier out', async () => {
    const stored = await service.setVenuePhoto({ userId: MANAGER }, await orange(), 'miniapp');
    expect(stored.photoKey).not.toBeNull();
    await expect(service.setVenuePhoto({ userId: CASHIER }, await orange(), 'miniapp')).rejects.toMatchObject(
      {
        status: 403,
        code: 'venue_forbidden',
      },
    );
    await expect(service.removeVenuePhoto({ userId: CASHIER }, 'miniapp')).rejects.toMatchObject({
      status: 403,
    });
  });

  it('answers 404 to someone without a workplace and for a foreign venue id', async () => {
    await expect(
      service.setVenuePhoto({ userId: STRANGER }, await orange(), 'miniapp'),
    ).rejects.toMatchObject({
      status: 404,
      code: 'venue_not_found',
    });
    const other = await seedVenue(pool, STRANGER);
    await expect(
      service.setVenuePhoto({ userId: STRANGER, venueId: venue.id }, await orange(), 'miniapp'),
    ).rejects.toMatchObject({ status: 404 });
    expect(other.photoKey).toBeNull();
    expect(storage.keys()).toEqual([]);
  });

  it('replaces the photo and deletes the old file', async () => {
    const first = await service.setVenuePhoto({ userId: OWNER }, await orange(), 'miniapp');
    const second = await service.setVenuePhoto({ userId: OWNER }, await blue(), 'miniapp');
    expect(second.photoKey).not.toBe(first.photoKey);
    expect(storage.keys()).toEqual([second.photoKey]);
  });

  it('treats an upload of the same file again as a no-op for storage', async () => {
    const first = await service.setVenuePhoto({ userId: OWNER }, await orange(), 'miniapp');
    const again = await service.setVenuePhoto({ userId: OWNER }, await orange(), 'miniapp');
    expect(again.photoKey).toBe(first.photoKey);
    expect(storage.keys()).toEqual([first.photoKey]);
    expect(await service.read(first.photoKey ?? '', 'card')).not.toBeNull();
  });

  it('removes the photo and the file, and does nothing when there is none', async () => {
    await service.setVenuePhoto({ userId: OWNER }, await orange(), 'miniapp');
    const removed = await service.removeVenuePhoto({ userId: OWNER }, 'miniapp');
    expect(removed.photoKey).toBeNull();
    expect(storage.keys()).toEqual([]);
    expect((await service.removeVenuePhoto({ userId: OWNER }, 'miniapp')).photoKey).toBeNull();
  });

  it('rejects oversize and unreadable files before storing anything', async () => {
    await expect(
      service.setVenuePhoto({ userId: OWNER }, Buffer.alloc(MAX_PHOTO_BYTES + 1), 'miniapp'),
    ).rejects.toMatchObject({ status: 413, code: 'image_too_large' });
    await expect(
      service.setVenuePhoto({ userId: OWNER }, Buffer.from('\xff\xd8\xffnot really'), 'miniapp'),
    ).rejects.toMatchObject({ status: 422, code: 'image_unreadable' });
    expect(storage.keys()).toEqual([]);
  });

  it('writes upload and removal to the audit log', async () => {
    await service.setVenuePhoto({ userId: OWNER }, await orange(), 'miniapp');
    await service.removeVenuePhoto({ userId: OWNER }, 'miniapp');
    await service.removeVenuePhoto({ userId: OWNER }, 'miniapp');
    const page = await audit.list({ userId: OWNER }, {});
    expect(page.items.map((entry) => [entry.action, entry.target, entry.details])).toEqual([
      ['venue.photo', { type: 'venue', id: venue.id }, { removed: true, channel: 'miniapp' }],
      ['venue.photo', { type: 'venue', id: venue.id }, { removed: false, channel: 'miniapp' }],
    ]);
  });
});

describe('menu item photo', () => {
  it('stores and replaces a photo for the item of the venue', async () => {
    const first = await service.setMenuItemPhoto({ userId: MANAGER }, item.id, await orange(), 'miniapp');
    expect(first.photoKey).not.toBeNull();
    const second = await service.setMenuItemPhoto({ userId: OWNER }, item.id, await blue(), 'miniapp');
    expect(storage.keys()).toEqual([second.photoKey]);
  });

  it('keeps a cashier out and answers 404 for a missing or foreign item', async () => {
    await expect(
      service.setMenuItemPhoto({ userId: CASHIER }, item.id, await orange(), 'miniapp'),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.setMenuItemPhoto({ userId: OWNER }, 999_999, await orange(), 'miniapp'),
    ).rejects.toMatchObject({ status: 404, code: 'menu_item_not_found' });
    const other = await seedVenue(pool, STRANGER);
    const foreign = await seedMenuItem(pool, other.id);
    await expect(
      service.setMenuItemPhoto({ userId: OWNER }, foreign.id, await orange(), 'miniapp'),
    ).rejects.toMatchObject({ status: 404, code: 'menu_item_not_found' });
    expect(storage.keys()).toEqual([]);
  });

  it('keeps a shared file until the last item using it lets go', async () => {
    const one = await service.setMenuItemPhoto({ userId: OWNER }, item.id, await orange(), 'miniapp');
    const two = await service.setMenuItemPhoto({ userId: OWNER }, secondItem.id, await orange(), 'miniapp');
    expect(two.photoKey).toBe(one.photoKey);
    await service.removeMenuItemPhoto({ userId: OWNER }, item.id, 'miniapp');
    expect(storage.keys()).toEqual([one.photoKey]);
    await service.removeMenuItemPhoto({ userId: OWNER }, secondItem.id, 'miniapp');
    expect(storage.keys()).toEqual([]);
  });

  it('keeps the file while the venue photo uses the same picture', async () => {
    const forVenue = await service.setVenuePhoto({ userId: OWNER }, await orange(), 'miniapp');
    await service.setMenuItemPhoto({ userId: OWNER }, item.id, await orange(), 'miniapp');
    await service.removeMenuItemPhoto({ userId: OWNER }, item.id, 'miniapp');
    expect(storage.keys()).toEqual([forVenue.photoKey]);
  });

  it('deletes the file when the item leaves the menu', async () => {
    await service.setMenuItemPhoto({ userId: OWNER }, item.id, await orange(), 'miniapp');
    await menu.archive({ userId: OWNER }, item.id, 'miniapp');
    expect(storage.keys()).toEqual([]);
    const { rows } = await pool.query('select photo_key from menu_items where id = $1', [item.id]);
    expect(rows).toEqual([{ photo_key: null }]);
  });

  it('writes the audit entry with the item name', async () => {
    await service.setMenuItemPhoto({ userId: OWNER }, item.id, await orange(), 'miniapp');
    await service.removeMenuItemPhoto({ userId: OWNER }, item.id, 'miniapp');
    const page = await audit.list({ userId: OWNER }, {});
    expect(page.items.map((entry) => [entry.action, entry.target.id, entry.details])).toEqual([
      ['menu_item.photo', item.id, { name: 'Эклер', removed: true, channel: 'miniapp' }],
      ['menu_item.photo', item.id, { name: 'Эклер', removed: false, channel: 'miniapp' }],
    ]);
  });
});

describe('read', () => {
  it('answers null for a key that is not a hash or has no file', async () => {
    expect(await service.read('../etc/passwd', 'card')).toBeNull();
    expect(await service.read('b'.repeat(64), 'card')).toBeNull();
  });
});
