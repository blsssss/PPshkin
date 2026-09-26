import { one, type Queryable } from '../src/db/pool.ts';
import { CONSENT_DOCUMENTS } from '../src/domain/consents.ts';
import type { Booking, MenuItem } from '../src/domain/models.ts';
import type { BookingStatus } from '../src/domain/vocabulary.ts';
import * as consents from '../src/repositories/consents.ts';
import type { BookingsService, BookingView } from '../src/services/bookings.ts';
import { sampleMenuItem, sampleVenue, seedUser } from './venues.ts';

const HOUR_MS = 3_600_000;

export async function seedGuest(db: Queryable, userId: number, consentedAt: Date): Promise<void> {
  await seedUser(db, userId);
  const version = CONSENT_DOCUMENTS.personal_data.version;
  await consents.grant(db, userId, 'personal_data', version, 'miniapp', consentedAt);
}

export interface BookingSeed {
  userId: number | null;
  item: MenuItem;
  code: string;
  createdAt: Date;
  dealId?: number | null;
  status?: BookingStatus;
  priceRub?: number;
  expiresAt?: Date;
  resolvedAt?: Date | null;
}

export async function seedBooking(db: Queryable, seed: BookingSeed): Promise<number> {
  const status = seed.status ?? 'active';
  const row = await one<{ id: number }>(
    db,
    `insert into bookings (user_id, venue_id, menu_item_id, deal_id, code, item_name, price_rub, kcal, status,
                           expires_at, created_at, resolved_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     returning id`,
    [
      seed.userId,
      seed.item.venueId,
      seed.item.id,
      seed.dealId ?? null,
      seed.code,
      seed.item.name,
      seed.priceRub ?? seed.item.priceRub,
      seed.item.kcal,
      status,
      seed.expiresAt ?? new Date(seed.createdAt.getTime() + HOUR_MS),
      seed.createdAt,
      status === 'active' ? null : (seed.resolvedAt ?? seed.createdAt),
    ],
  );
  return row.id;
}

export async function seedOffer(
  db: Queryable,
  seed: {
    userId: number | null;
    item: MenuItem;
    createdAt: Date;
    status?: 'shown' | 'accepted' | 'declined';
  },
): Promise<number> {
  const row = await one<{ id: number }>(
    db,
    `insert into offers (user_id, venue_id, menu_item_id, channel, score, explanation, status, created_at,
                         responded_at)
     values ($1, $2, $3, 'miniapp', 0.5, '{}'::jsonb, $4, $5, $6)
     returning id`,
    [
      seed.userId,
      seed.item.venueId,
      seed.item.id,
      seed.status ?? 'shown',
      seed.createdAt,
      (seed.status ?? 'shown') === 'shown' ? null : seed.createdAt,
    ],
  );
  return row.id;
}

export const SAMPLE_PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);

export const sampleBooking: Booking = {
  id: 31,
  userId: 101,
  venueId: sampleVenue.id,
  menuItemId: sampleMenuItem.id,
  dealId: 21,
  offerId: 501,
  code: 'K7MP4X',
  itemName: 'Эклер',
  priceRub: 130,
  kcal: 330,
  status: 'active',
  expiresAt: new Date('2026-09-25T10:00:00Z'),
  createdAt: new Date('2026-09-25T09:00:00Z'),
  resolvedAt: null,
};

export const sampleBookingView: BookingView = {
  booking: sampleBooking,
  item: sampleMenuItem,
  venue: sampleVenue,
};

export const sampleBookingJson = {
  id: 31,
  code: 'K7MP4X',
  qrPayload: 'ppshkin:booking:K7MP4X',
  status: 'active',
  expiresAt: '2026-09-25T10:00:00.000Z',
  createdAt: '2026-09-25T09:00:00.000Z',
  resolvedAt: null,
  dealId: 21,
  item: {
    id: 11,
    name: 'Эклер',
    description: 'Заварное тесто и ванильный крем',
    category: 'dessert',
    priceRub: 200,
    weightG: 80,
    kcal: 330,
    proteinG: 5,
    fatG: 18,
    carbsG: 38.2,
    nutritionSource: 'venue',
    tags: ['dessert', 'sweet'],
    isAvailable: true,
  },
  venue: {
    id: 7,
    name: 'Кофейня «Зерно»',
    address: 'ул. Баумана, 36',
    category: 'coffee',
    location: { lat: 55.7887, lon: 49.1221 },
    opensAt: '08:00',
    closesAt: '22:00',
    timezone: 'Europe/Moscow',
    isDemo: false,
  },
  priceRub: 130,
  kcal: 330,
};

export function bookingsStub(overrides: Partial<BookingsService> = {}): BookingsService {
  return {
    create: () => Promise.resolve(sampleBookingView),
    list: () => Promise.resolve([sampleBookingView]),
    get: () => Promise.resolve(sampleBookingView),
    qr: () => Promise.resolve(SAMPLE_PNG),
    cancel: () => Promise.resolve(sampleBookingView),
    listForVenue: () => Promise.resolve([sampleBookingView]),
    redeem: () => Promise.resolve(sampleBookingView),
    expireDue: () => Promise.resolve([]),
    ...overrides,
  };
}
