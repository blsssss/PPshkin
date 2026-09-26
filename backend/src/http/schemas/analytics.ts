import { z } from 'zod';
import { TOP_ITEMS_LIMIT, type VenueAnalytics } from '../../services/analytics.ts';
import { optionalLocalDate } from './bookings.ts';

const LocalDate = z.string().meta({ format: 'date', examples: ['2026-09-25'] });

export const AnalyticsQuery = z.object({
  from: optionalLocalDate(
    'Первый день периода YYYY-MM-DD по часовому поясу заведения, по умолчанию 6 дней до to',
  ),
  to: optionalLocalDate('Последний день периода включительно, по умолчанию сегодня'),
});

const Count = z.number().int();
const Rub = z.number().int().describe('Рубли');

const TopItemSchema = z
  .object({
    menuItemId: z.number().int(),
    name: z.string().describe('Текущее название позиции'),
    redeemed: Count.describe('Сколько броней погашено'),
    revenueRub: Rub.describe('Выручка по погашенным броням'),
  })
  .meta({ id: 'VenueTopItem', description: 'Позиция среди самых продаваемых через брони' });

const AnalyticsDaySchema = z
  .object({
    date: LocalDate,
    offersShown: Count,
    offersAccepted: Count,
    bookingsCreated: Count,
    bookingsRedeemed: Count,
    revenueRub: Rub,
  })
  .meta({ id: 'VenueAnalyticsDay', description: 'Показатели за один день по часовому поясу заведения' });

export const VenueAnalyticsSchema = z
  .object({
    from: LocalDate,
    to: LocalDate,
    timezone: z.string().describe('Часовой пояс заведения, по которому считаются дни'),
    offersShown: Count.describe('Сколько раз гостям предложили позиции заведения'),
    offersAccepted: Count.describe('Сколько из этих предложений гости забронировали'),
    bookingsCreated: Count.describe('Сколько броней создано'),
    bookingsRedeemed: Count.describe('Сколько из них погашено'),
    bookingsExpired: Count.describe('Сколько из них истекло'),
    bookingsCancelled: Count.describe('Сколько из них отменили гости'),
    acceptRate: z.number().describe('offersAccepted / offersShown, до сотых; 0, если предложений не было'),
    redeemRate: z.number().describe('bookingsRedeemed / bookingsCreated, до сотых; 0, если броней не было'),
    revenueRub: Rub.describe('Выручка по погашенным броням'),
    surplusUnitsSold: Count.describe('Сколько порций горящих предложений продано вместо списания'),
    surplusRevenueRub: Rub.describe('Выручка с этих порций'),
    topItems: z
      .array(TopItemSchema)
      .describe(`До ${TOP_ITEMS_LIMIT} позиций с наибольшим числом погашенных броней`),
    byDay: z
      .array(AnalyticsDaySchema)
      .describe('Каждый день периода, включая дни без событий, от старых к новым'),
  })
  .meta({
    id: 'VenueAnalytics',
    description:
      'Итоги заведения за период. Предложения и брони относятся к дню, в который они созданы. Данных гостей в ответе нет',
  });

export function toVenueAnalytics(analytics: VenueAnalytics): z.infer<typeof VenueAnalyticsSchema> {
  return {
    from: analytics.from,
    to: analytics.to,
    timezone: analytics.timezone,
    offersShown: analytics.offersShown,
    offersAccepted: analytics.offersAccepted,
    bookingsCreated: analytics.bookingsCreated,
    bookingsRedeemed: analytics.bookingsRedeemed,
    bookingsExpired: analytics.bookingsExpired,
    bookingsCancelled: analytics.bookingsCancelled,
    acceptRate: analytics.acceptRate,
    redeemRate: analytics.redeemRate,
    revenueRub: analytics.revenueRub,
    surplusUnitsSold: analytics.surplusUnitsSold,
    surplusRevenueRub: analytics.surplusRevenueRub,
    topItems: analytics.topItems.map((item) => ({
      menuItemId: item.menuItemId,
      name: item.name,
      redeemed: item.redeemed,
      revenueRub: item.revenueRub,
    })),
    byDay: analytics.byDay.map((day) => ({
      date: day.date,
      offersShown: day.offersShown,
      offersAccepted: day.offersAccepted,
      bookingsCreated: day.bookingsCreated,
      bookingsRedeemed: day.bookingsRedeemed,
      revenueRub: day.revenueRub,
    })),
  };
}
