import { z } from 'zod';
import type { Venue } from '../../domain/models.ts';
import { VENUE_CATEGORIES } from '../../domain/vocabulary.ts';
import type { DealCardView, VenueCardView, VenueDetailsView } from '../../services/catalog.ts';
import { blankAsMissing, GeoPointSchema, PointQueryFields, pointTogether } from './common.ts';
import { DealSchema, toDeal } from './deals.ts';
import { MenuItemSchema, toMenuItem } from './menu.ts';

const LocalTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const DistanceMeters = z
  .number()
  .int()
  .nullable()
  .describe('Расстояние от точки поиска в метрах; null, если точка неизвестна');

const OpenNow = z.boolean().describe('Открыто ли заведение сейчас по часам работы');

export const VenueSchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
    address: z.string(),
    category: z.enum(VENUE_CATEGORIES),
    location: GeoPointSchema,
    opensAt: z.string().describe('Время открытия ЧЧ:ММ в часовом поясе заведения'),
    closesAt: z
      .string()
      .describe(
        'Время закрытия ЧЧ:ММ; раньше opensAt - закрытие после полуночи, равно opensAt - круглосуточно',
      ),
    timezone: z.string().describe('Часовой пояс IANA'),
    isDemo: z.boolean().describe('Тестовое заведение: покажите пометку «Заведение и меню тестовые»'),
  })
  .meta({ id: 'Venue', description: 'Заведение' });

export const VenueCardSchema = z
  .object({
    venue: VenueSchema,
    distanceM: DistanceMeters,
    openNow: OpenNow,
    activeDeals: z.number().int().describe('Сколько горящих предложений доступно гостю'),
  })
  .meta({ id: 'VenueCard', description: 'Заведение в списке рядом' });

export const VenueCardListSchema = z.object({ items: z.array(VenueCardSchema) });

export const VenueDetailsSchema = z
  .object({
    venue: VenueSchema,
    openNow: OpenNow,
    menu: z.array(MenuItemSchema).describe('Доступные гостю позиции по категориям и названию'),
    deals: z.array(DealSchema).describe('Горящие предложения, которые можно забронировать сейчас'),
  })
  .meta({ id: 'VenueDetails', description: 'Карточка заведения для гостя' });

export const DealCardSchema = z
  .object({
    deal: DealSchema,
    item: MenuItemSchema,
    venue: VenueSchema,
    distanceM: DistanceMeters,
  })
  .meta({ id: 'DealCard', description: 'Горящее предложение в ленте рядом' });

export const DealCardListSchema = z.object({ items: z.array(DealCardSchema) });

export const VenueBody = z.object({
  name: z.string().trim().min(1).max(120).describe('Название для гостей'),
  address: z.string().trim().min(1).max(200).describe('Адрес для гостей'),
  category: z.enum(VENUE_CATEGORIES),
  location: GeoPointSchema.describe('Точные координаты заведения'),
  opensAt: LocalTime.optional().describe('Время открытия ЧЧ:ММ, по умолчанию 08:00'),
  closesAt: LocalTime.optional().describe(
    'Время закрытия ЧЧ:ММ, по умолчанию 22:00; раньше opensAt - закрытие после полуночи, равно opensAt - круглосуточно',
  ),
  timezone: z.string().min(1).max(64).optional().describe('Часовой пояс IANA, по умолчанию Europe/Moscow'),
});

export const VenuePatchBody = VenueBody.partial()
  .refine((patch) => Object.keys(patch).length > 0, 'Provide at least one field to change')
  .meta({ minProperties: 1 });

export const NearbyQuery = z
  .object({
    ...PointQueryFields,
    radius: z
      .preprocess(blankAsMissing, z.coerce.number().int().min(100).max(10_000).default(3000))
      .describe('Радиус поиска в метрах, применяется при известной точке'),
  })
  .check(pointTogether);

export function toVenue(venue: Venue): z.infer<typeof VenueSchema> {
  return {
    id: venue.id,
    name: venue.name,
    address: venue.address,
    category: venue.category,
    location: venue.location,
    opensAt: venue.opensAt,
    closesAt: venue.closesAt,
    timezone: venue.timezone,
    isDemo: venue.isDemo,
  };
}

export function toVenueCard(card: VenueCardView): z.infer<typeof VenueCardSchema> {
  return {
    venue: toVenue(card.venue),
    distanceM: card.distanceM,
    openNow: card.openNow,
    activeDeals: card.activeDeals,
  };
}

export function toVenueDetails(details: VenueDetailsView): z.infer<typeof VenueDetailsSchema> {
  return {
    venue: toVenue(details.venue),
    openNow: details.openNow,
    menu: details.menu.map(toMenuItem),
    deals: details.deals.map(toDeal),
  };
}

export function toDealCard(card: DealCardView): z.infer<typeof DealCardSchema> {
  return {
    deal: toDeal(card.deal),
    item: toMenuItem(card.deal.item),
    venue: toVenue(card.venue),
    distanceM: card.distanceM,
  };
}
