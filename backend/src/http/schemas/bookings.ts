import { z } from 'zod';
import { qrPayload } from '../../domain/bookings.ts';
import { BOOKING_STATUSES } from '../../domain/vocabulary.ts';
import { BOOKING_LIST_FILTERS, type BookingView } from '../../services/bookings.ts';
import { isLocalDate } from '../../shared/time.ts';
import { IsoDateTime, iso, isoOrNull } from './common.ts';
import { MenuItemSchema, toMenuItem } from './menu.ts';
import { toVenue, VenueSchema } from './venues.ts';

const Id = z.number().int().positive();

export const optionalLocalDate = (description: string) =>
  z
    .string()
    .refine(isLocalDate, 'expected a calendar date in YYYY-MM-DD format')
    .optional()
    .meta({ format: 'date', examples: ['2026-09-25'], description });

export const BookingBody = z
  .object({
    menuItemId: Id.describe('Позиция меню, которую гость бронирует'),
    dealId: Id.optional().describe(
      'Горящее предложение на эту позицию: порция резервируется по цене предложения. Без dealId бронь по цене меню',
    ),
    offerId: Id.optional().describe(
      'offerId из GET /api/v1/recommendations, если гость бронирует из подбора: предложение отмечается принятым, даже если гость раньше от него отказался',
    ),
  })
  .meta({ id: 'BookingRequest', description: 'Что забронировать' });

export const RedeemBody = z
  .object({
    code: z
      .string()
      .min(1)
      .max(64)
      .describe(
        'Код брони, который назвал гость, или value из WebApp.openCodeReader как есть: регистр и пробелы не важны, принимается и ppshkin:booking:<код>',
      ),
  })
  .meta({ id: 'Redeem', description: 'Код брони для погашения' });

export const BookingListQuery = z.object({
  status: z
    .enum(BOOKING_LIST_FILTERS)
    .default('active')
    .describe('active - действующие брони; history - погашенные, отменённые и истёкшие'),
});

export const VenueBookingListQuery = BookingListQuery.extend({
  date: optionalLocalDate('Только брони, созданные в эти сутки YYYY-MM-DD по часовому поясу заведения'),
});

export const BookingSchema = z
  .object({
    id: z.number().int(),
    code: z
      .string()
      .describe(
        'Код брони из 6 символов: латинские буквы без I и O и цифры от 2 до 9. Гость называет его на кассе',
      ),
    qrPayload: z
      .string()
      .describe('Содержимое QR-кода брони, ppshkin:booking:<code>. Из него можно нарисовать QR на клиенте'),
    status: z
      .enum(BOOKING_STATUSES)
      .describe(
        'active - ждёт гостя до expiresAt; redeemed - погашена заведением; cancelled - отменена гостем; expired - время вышло, порция вернулась в продажу',
      ),
    expiresAt: IsoDateTime,
    createdAt: IsoDateTime,
    resolvedAt: IsoDateTime.nullable(),
    dealId: z
      .number()
      .int()
      .nullable()
      .describe('Горящее предложение, по которому зарезервирована порция; null для брони по цене меню'),
    item: MenuItemSchema,
    venue: VenueSchema,
    priceRub: z.number().int().describe('Цена на момент бронирования с учётом горящего предложения'),
    kcal: z.number().int().describe('Калорийность порции на момент бронирования'),
  })
  .meta({
    id: 'Booking',
    description:
      'Бронь блюда. expiresAt - до какого момента бронь действует, resolvedAt - когда погашена, отменена или истекла. item - текущая позиция меню, она может быть уже убрана из меню. Данных гостя в брони нет',
  });

export const BookingListSchema = z.object({ items: z.array(BookingSchema) });

export const BookingQrSchema = z
  .custom<Buffer>((value) => Buffer.isBuffer(value))
  .meta({
    type: 'string',
    format: 'binary',
    description: 'PNG 512 x 512 с QR-кодом qrPayload',
  });

export function toBooking({ booking, item, venue }: BookingView): z.infer<typeof BookingSchema> {
  return {
    id: booking.id,
    code: booking.code,
    qrPayload: qrPayload(booking.code),
    status: booking.status,
    expiresAt: iso(booking.expiresAt),
    createdAt: iso(booking.createdAt),
    resolvedAt: isoOrNull(booking.resolvedAt),
    dealId: booking.dealId,
    item: toMenuItem(item),
    venue: toVenue(venue),
    priceRub: booking.priceRub,
    kcal: booking.kcal,
  };
}
