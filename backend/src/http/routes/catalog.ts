import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { z } from 'zod';
import type { CatalogQuery, CatalogService } from '../../services/catalog.ts';
import { bearerSecurity, requireAuth, userId } from '../auth.ts';
import { errorResponses, IdParams, queryPoint, success } from '../schemas/common.ts';
import {
  DealCardListSchema,
  NearbyQuery,
  toDealCard,
  toVenueCard,
  toVenueDetails,
  VenueCardListSchema,
  VenueDetailsSchema,
} from '../schemas/venues.ts';

const SEARCH_POINT = [
  'Точка поиска: lat и lon из запроса, иначе сохранённое приблизительное местоположение пользователя.',
  'Если точки нет, радиус не применяется и distanceM равен null. Пустые параметры считаются непереданными.',
].join(' ');
const BAD_QUERY = 'Коды ошибок: validation_failed (400, передайте lat и lon вместе, radius от 100 до 10000).';

function catalogQuery(query: z.infer<typeof NearbyQuery>): CatalogQuery {
  return { point: queryPoint(query), radiusM: query.radius };
}

export const catalogRoutes: FastifyPluginCallbackZod<{ catalog: CatalogService }> = (
  app,
  { catalog },
  done,
) => {
  app.get(
    '/venues',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'listNearbyVenues',
        tags: ['catalog'],
        summary: 'Заведения рядом',
        description: [
          SEARCH_POINT,
          'С точкой заведения идут по расстоянию, без точки сначала открытые, затем по названию. Не больше 50.',
          BAD_QUERY,
        ].join(' '),
        security: bearerSecurity,
        querystring: NearbyQuery,
        response: { 200: success('Заведения', VenueCardListSchema), ...errorResponses(400, 401) },
      },
    },
    async (request) => ({
      items: (await catalog.venues(userId(request), catalogQuery(request.query))).map(toVenueCard),
    }),
  );

  app.get(
    '/venues/:id',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'getVenueDetails',
        tags: ['catalog'],
        summary: 'Карточка заведения',
        description: [
          'Меню из доступных позиций и горящие предложения, которые можно забронировать сейчас.',
          'Коды ошибок: venue_not_found (404, заведение не найдено, вернитесь к списку),',
          'validation_failed (400, id должен быть положительным целым числом).',
        ].join(' '),
        security: bearerSecurity,
        params: IdParams,
        response: {
          200: success('Заведение, меню и предложения', VenueDetailsSchema),
          ...errorResponses(400, 401, 404),
        },
      },
    },
    async (request) => toVenueDetails(await catalog.venue(userId(request), request.params.id)),
  );

  app.get(
    '/deals',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'listNearbyDeals',
        tags: ['catalog'],
        summary: 'Горящие предложения рядом',
        description: [
          'Предложения заведений, которые открыты сейчас: сначала заканчивающиеся раньше, затем ближайшие. Не больше 50.',
          SEARCH_POINT,
          BAD_QUERY,
        ].join(' '),
        security: bearerSecurity,
        querystring: NearbyQuery,
        response: { 200: success('Горящие предложения', DealCardListSchema), ...errorResponses(400, 401) },
      },
    },
    async (request) => ({
      items: (await catalog.deals(userId(request), catalogQuery(request.query))).map(toDealCard),
    }),
  );

  done();
};
