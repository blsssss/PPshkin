import { withTransaction, type Pool } from '../db/pool.ts';
import type { AuditChannel } from '../domain/audit.ts';
import type { MenuItem, Venue } from '../domain/models.ts';
import { PHOTO_KEY_PATTERN, type PhotoSize, type PhotoStorage } from '../ports/photo-storage.ts';
import * as audit from '../repositories/audit.ts';
import * as menuItems from '../repositories/menu-items.ts';
import * as photos from '../repositories/photos.ts';
import * as venues from '../repositories/venues.ts';
import { processPhoto, MAX_PHOTO_BYTES, UnreadablePhotoError } from '../photos/process.ts';
import type { Clock } from '../shared/clock.ts';
import { AppError, unprocessable } from '../shared/errors.ts';
import { resolveVenueAccess, type VenueActor } from './access.ts';
import { removeIfUnused } from './photo-files.ts';
import { lockMenuItem } from './menu.ts';

export interface PhotosService {
  setVenuePhoto(actor: VenueActor, data: Buffer, channel: AuditChannel): Promise<Venue>;
  removeVenuePhoto(actor: VenueActor, channel: AuditChannel): Promise<Venue>;
  setMenuItemPhoto(actor: VenueActor, itemId: number, data: Buffer, channel: AuditChannel): Promise<MenuItem>;
  removeMenuItemPhoto(actor: VenueActor, itemId: number, channel: AuditChannel): Promise<MenuItem>;
  read(key: string, size: PhotoSize): Promise<Buffer | null>;
}

interface PhotosDependencies {
  pool: Pool;
  clock: Clock;
  storage: PhotoStorage;
}

async function prepare(data: Buffer) {
  if (data.length > MAX_PHOTO_BYTES) {
    throw new AppError(413, 'image_too_large', `Photo is larger than ${MAX_PHOTO_BYTES / 1024 / 1024} MB`);
  }
  try {
    return await processPhoto(data);
  } catch (error) {
    if (error instanceof UnreadablePhotoError) throw unprocessable('image_unreadable', error.message);
    throw error;
  }
}

export function createPhotosService({ pool, clock, storage }: PhotosDependencies): PhotosService {
  return {
    async setVenuePhoto(actor, data, channel) {
      const { venue } = await resolveVenueAccess(pool, actor, 'venue.edit');
      const processed = await prepare(data);
      return withTransaction(pool, async (client) => {
        await photos.lockPhotos(client);
        const locked = await venues.lockById(client, venue.id);
        const now = clock.now();
        await storage.put(processed.key, processed.variants);
        const updated = await venues.setPhotoKey(client, venue.id, processed.key, now);
        await audit.record(
          client,
          {
            venueId: venue.id,
            actorUserId: actor.userId,
            action: 'venue.photo',
            target: { type: 'venue', id: venue.id },
            channel,
            details: { removed: false },
          },
          now,
        );
        if (locked?.photoKey !== processed.key)
          await removeIfUnused(client, storage, locked?.photoKey ?? null);
        return updated;
      });
    },

    async removeVenuePhoto(actor, channel) {
      const { venue } = await resolveVenueAccess(pool, actor, 'venue.edit');
      return withTransaction(pool, async (client) => {
        await photos.lockPhotos(client);
        const locked = await venues.lockById(client, venue.id);
        const now = clock.now();
        const updated = await venues.setPhotoKey(client, venue.id, null, now);
        if (locked?.photoKey) {
          await audit.record(
            client,
            {
              venueId: venue.id,
              actorUserId: actor.userId,
              action: 'venue.photo',
              target: { type: 'venue', id: venue.id },
              channel,
              details: { removed: true },
            },
            now,
          );
        }
        await removeIfUnused(client, storage, locked?.photoKey ?? null);
        return updated;
      });
    },

    async setMenuItemPhoto(actor, itemId, data, channel) {
      const { venue } = await resolveVenueAccess(pool, actor, 'menu.edit');
      const processed = await prepare(data);
      return withTransaction(pool, async (client) => {
        await photos.lockPhotos(client);
        const item = await lockMenuItem(client, venue.id, itemId);
        const now = clock.now();
        await storage.put(processed.key, processed.variants);
        const updated = await menuItems.setPhotoKey(client, item.id, processed.key, now);
        await audit.record(
          client,
          {
            venueId: venue.id,
            actorUserId: actor.userId,
            action: 'menu_item.photo',
            target: { type: 'menu_item', id: item.id },
            channel,
            details: { name: item.name, removed: false },
          },
          now,
        );
        if (item.photoKey !== processed.key) await removeIfUnused(client, storage, item.photoKey);
        return updated;
      });
    },

    async removeMenuItemPhoto(actor, itemId, channel) {
      const { venue } = await resolveVenueAccess(pool, actor, 'menu.edit');
      return withTransaction(pool, async (client) => {
        await photos.lockPhotos(client);
        const item = await lockMenuItem(client, venue.id, itemId);
        const now = clock.now();
        const updated = await menuItems.setPhotoKey(client, item.id, null, now);
        if (item.photoKey) {
          await audit.record(
            client,
            {
              venueId: venue.id,
              actorUserId: actor.userId,
              action: 'menu_item.photo',
              target: { type: 'menu_item', id: item.id },
              channel,
              details: { name: item.name, removed: true },
            },
            now,
          );
        }
        await removeIfUnused(client, storage, item.photoKey);
        return updated;
      });
    },

    read(key, size) {
      if (!PHOTO_KEY_PATTERN.test(key)) return Promise.resolve(null);
      return storage.get(key, size);
    },
  };
}
