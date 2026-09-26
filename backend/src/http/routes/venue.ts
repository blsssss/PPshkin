import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { DealsService } from '../../services/deals.ts';
import type { MenuImportsService } from '../../services/menu-imports.ts';
import type { MenuService } from '../../services/menu.ts';
import type { VenuesService } from '../../services/venues.ts';
import { bearerSecurity, requireAuth, userId } from '../auth.ts';
import { errorResponses, IdParams, noContent, success } from '../schemas/common.ts';
import {
  DealBody,
  DealListQuery,
  DealListSchema,
  DealPatchBody,
  DealSchema,
  toDeal,
} from '../schemas/deals.ts';
import {
  ApplyMenuImportBody,
  MenuImportSchema,
  MenuImportTextBody,
  MenuItemBody,
  MenuItemListSchema,
  MenuItemPatchBody,
  MenuItemSchema,
  toMenuImport,
  toMenuItem,
} from '../schemas/menu.ts';
import { toVenue, VenueBody, VenuePatchBody, VenueSchema } from '../schemas/venues.ts';
import { IMAGE_UPLOAD_ERROR_STATUSES, readImageUpload } from '../uploads.ts';

interface VenueRouteOptions {
  venues: VenuesService;
  menu: MenuService;
  menuImports: MenuImportsService;
  deals: DealsService;
}

const NO_VENUE = 'venue_not_found (404, заведения ещё нет, предложите создать его через POST /api/v1/venue)';
const BAD_INPUT = 'validation_failed (400, исправьте поля из errors)';
const BAD_ID = 'validation_failed (400, id должен быть положительным целым числом)';

const IMPORT_POLLING =
  'Ответ 202 со статусом processing, распознавание идёт в фоне: опрашивайте GET /api/v1/venue/menu/imports/{id} раз в 2 секунды.';
const IMPORT_LIMITS = [
  'Коды ошибок: import_in_progress (409, предыдущий импорт ещё распознаётся, дождитесь его),',
  'import_limit_reached (409, не больше 20 импортов за сутки, попробуйте завтра или добавьте позиции вручную),',
].join(' ');

export const venueRoutes: FastifyPluginCallbackZod<VenueRouteOptions> = (
  app,
  { venues, menu, menuImports, deals },
  done,
) => {
  app.post(
    '/venue',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'createVenue',
        tags: ['venue'],
        summary: 'Подключить заведение',
        description: [
          'Создаёт заведение, владельцем становится текущий пользователь. У пользователя может быть только одно заведение.',
          'Без opensAt и closesAt часы работы 08:00-22:00, без timezone часовой пояс Europe/Moscow.',
          'Коды ошибок: venue_exists (409, заведение уже подключено, откройте его через GET /api/v1/venue),',
          `invalid_timezone (422, выберите часовой пояс из базы IANA), ${BAD_INPUT}.`,
        ].join(' '),
        security: bearerSecurity,
        body: VenueBody,
        response: {
          201: success('Заведение создано', VenueSchema),
          ...errorResponses(400, 401, 409, 413, 415, 422),
        },
      },
    },
    async (request, reply) =>
      reply.code(201).send(toVenue(await venues.create(userId(request), request.body))),
  );

  app.get(
    '/venue',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'getVenue',
        tags: ['venue'],
        summary: 'Заведение текущего пользователя',
        description: `Коды ошибок: ${NO_VENUE}.`,
        security: bearerSecurity,
        response: { 200: success('Заведение', VenueSchema), ...errorResponses(401, 404) },
      },
    },
    async (request) => toVenue(await venues.get(userId(request))),
  );

  app.patch(
    '/venue',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'updateVenue',
        tags: ['venue'],
        summary: 'Изменить заведение',
        description: [
          'Меняет только переданные поля, нужно хотя бы одно.',
          `Коды ошибок: ${NO_VENUE}, invalid_timezone (422, выберите часовой пояс из базы IANA), ${BAD_INPUT}.`,
        ].join(' '),
        security: bearerSecurity,
        body: VenuePatchBody,
        response: {
          200: success('Заведение изменено', VenueSchema),
          ...errorResponses(400, 401, 404, 413, 415, 422),
        },
      },
    },
    async (request) => toVenue(await venues.update(userId(request), request.body)),
  );

  app.get(
    '/venue/menu',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'listVenueMenu',
        tags: ['venue'],
        summary: 'Меню заведения',
        description: [
          'Все позиции, кроме удалённых, включая скрытые от гостей, по категориям и названию.',
          `Коды ошибок: ${NO_VENUE}.`,
        ].join(' '),
        security: bearerSecurity,
        response: { 200: success('Позиции меню', MenuItemListSchema), ...errorResponses(401, 404) },
      },
    },
    async (request) => ({ items: (await menu.list(userId(request))).map(toMenuItem) }),
  );

  app.post(
    '/venue/menu/items',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'createMenuItem',
        tags: ['venue'],
        summary: 'Добавить позицию в меню',
        description: [
          'Калорийность и БЖУ считаются указанными заведением (nutritionSource = venue).',
          `Коды ошибок: ${NO_VENUE}, ${BAD_INPUT}.`,
        ].join(' '),
        security: bearerSecurity,
        body: MenuItemBody,
        response: {
          201: success('Позиция добавлена', MenuItemSchema),
          ...errorResponses(400, 401, 404, 413, 415),
        },
      },
    },
    async (request, reply) =>
      reply.code(201).send(toMenuItem(await menu.create(userId(request), request.body))),
  );

  app.patch(
    '/venue/menu/items/:id',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'updateMenuItem',
        tags: ['venue'],
        summary: 'Изменить позицию меню',
        description: [
          'Меняет только переданные поля, нужно хотя бы одно. Если передана калорийность или БЖУ, nutritionSource становится venue.',
          'Коды ошибок: menu_item_not_found (404, позиция удалена или принадлежит другому заведению, обновите меню),',
          'deal_price_not_lower (422, на позицию есть горящее предложение: оставьте цену выше цены предложения или снимите его),',
          `${NO_VENUE}, ${BAD_INPUT}.`,
        ].join(' '),
        security: bearerSecurity,
        params: IdParams,
        body: MenuItemPatchBody,
        response: {
          200: success('Позиция изменена', MenuItemSchema),
          ...errorResponses(400, 401, 404, 413, 415, 422),
        },
      },
    },
    async (request) => toMenuItem(await menu.update(userId(request), request.params.id, request.body)),
  );

  app.delete(
    '/venue/menu/items/:id',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'archiveMenuItem',
        tags: ['venue'],
        summary: 'Убрать позицию из меню',
        description: [
          'Позиция архивируется: пропадает из меню, каталога и рекомендаций, её горящее предложение снимается. Уже оформленные брони действуют.',
          'Коды ошибок: menu_item_not_found (404, позиция уже удалена или принадлежит другому заведению),',
          `${NO_VENUE}, ${BAD_ID}.`,
        ].join(' '),
        security: bearerSecurity,
        params: IdParams,
        response: { 204: noContent('Позиция убрана'), ...errorResponses(400, 401, 404) },
      },
    },
    async (request, reply) => {
      await menu.archive(userId(request), request.params.id);
      return reply.code(204).send(null);
    },
  );

  app.post(
    '/venue/menu/imports/photo',
    {
      preValidation: requireAuth,
      config: { imageUpload: true, rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        operationId: 'importMenuFromPhoto',
        tags: ['venue'],
        summary: 'Распознать меню по фото',
        description: [
          'Фото меню в multipart/form-data, поле image: JPEG, PNG или WebP до 10 МБ. Распознавание фото обычно занимает 10-25 секунд, фото не сохраняется.',
          IMPORT_POLLING,
          IMPORT_LIMITS,
          'image_required, image_empty, invalid_multipart (400, приложите одно фото в поле image),',
          'image_too_large, upload_too_many_parts (413, пришлите одно фото до 10 МБ),',
          `multipart_required, unsupported_image_type (415, пришлите JPEG, PNG или WebP), ${NO_VENUE}.`,
        ].join(' '),
        security: bearerSecurity,
        response: {
          202: success('Импорт запущен', MenuImportSchema),
          ...errorResponses(...IMAGE_UPLOAD_ERROR_STATUSES, 401, 404, 409),
        },
      },
    },
    async (request, reply) => {
      const upload = await readImageUpload(request);
      return reply.code(202).send(toMenuImport(await menuImports.fromPhoto(userId(request), upload.data)));
    },
  );

  app.post(
    '/venue/menu/imports/text',
    {
      preValidation: requireAuth,
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        operationId: 'importMenuFromText',
        tags: ['venue'],
        summary: 'Разобрать меню из текста',
        description: [
          'Текст меню, каждая позиция с новой строки и с ценой. Разбор занимает несколько секунд.',
          IMPORT_POLLING,
          IMPORT_LIMITS,
          `${NO_VENUE}, ${BAD_INPUT}.`,
        ].join(' '),
        security: bearerSecurity,
        body: MenuImportTextBody,
        response: {
          202: success('Импорт запущен', MenuImportSchema),
          ...errorResponses(400, 401, 404, 409, 413, 415),
        },
      },
    },
    async (request, reply) =>
      reply.code(202).send(toMenuImport(await menuImports.fromText(userId(request), request.body.text))),
  );

  app.get(
    '/venue/menu/imports/:id',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'getMenuImport',
        tags: ['venue'],
        summary: 'Результат импорта меню',
        description: [
          'processing: продолжайте опрос; ready: покажите позиции владельцу для проверки и примените их; failed: покажите текст error.',
          'Импорт, который распознаётся дольше 30 минут, отдаётся как failed.',
          'Коды ошибок: import_not_found (404, импорт принадлежит другому заведению или не существует),',
          `${NO_VENUE}, ${BAD_ID}.`,
        ].join(' '),
        security: bearerSecurity,
        params: IdParams,
        response: { 200: success('Импорт меню', MenuImportSchema), ...errorResponses(400, 401, 404) },
      },
    },
    async (request) => toMenuImport(await menuImports.get(userId(request), request.params.id)),
  );

  app.post(
    '/venue/menu/imports/:id/apply',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'applyMenuImport',
        tags: ['venue'],
        summary: 'Добавить распознанные позиции в меню',
        description: [
          'Добавляет проверенные владельцем позиции одной транзакцией, калорийность помечается как оценка (nutritionSource = estimate).',
          'Цена обязательна у каждой позиции. Импорт применяется один раз.',
          'Коды ошибок: import_not_ready (409, импорт ещё распознаётся или завершился ошибкой),',
          'import_already_applied (409, позиции уже в меню, обновите меню),',
          `import_not_found (404, импорт принадлежит другому заведению или не существует), ${NO_VENUE}, ${BAD_INPUT}.`,
        ].join(' '),
        security: bearerSecurity,
        params: IdParams,
        body: ApplyMenuImportBody,
        response: {
          201: success('Позиции добавлены в меню', MenuItemListSchema),
          ...errorResponses(400, 401, 404, 409, 413, 415),
        },
      },
    },
    async (request, reply) => {
      const created = await menuImports.apply(userId(request), request.params.id, request.body.items);
      return reply.code(201).send({ items: created.map(toMenuItem) });
    },
  );

  app.get(
    '/venue/deals',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'listVenueDeals',
        tags: ['venue'],
        summary: 'Горящие предложения заведения',
        description: [
          'status=active: идущие и запланированные, сначала те, что заканчиваются раньше.',
          'status=finished: распроданные, закончившиеся и снятые за последние 7 дней, сначала последние.',
          `Коды ошибок: ${NO_VENUE}, ${BAD_INPUT}.`,
        ].join(' '),
        security: bearerSecurity,
        querystring: DealListQuery,
        response: { 200: success('Горящие предложения', DealListSchema), ...errorResponses(400, 401, 404) },
      },
    },
    async (request) => ({
      items: (await deals.list(userId(request), request.query.status)).map(toDeal),
    }),
  );

  app.post(
    '/venue/deals',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'createDeal',
        tags: ['venue'],
        summary: 'Выставить горящее предложение',
        description: [
          'Позиция продаётся со скидкой с текущего момента до endsAt, не дольше 24 часов.',
          'Если владелец выбирает скидку в процентах, цену считает клиент: round(цена позиции * (1 - процент / 100)).',
          'Коды ошибок: menu_item_not_found (404, позиция удалена или принадлежит другому заведению),',
          'menu_item_unavailable (422, позиция скрыта от гостей, сначала включите её),',
          'deal_price_not_lower (422, цена предложения должна быть ниже цены в меню),',
          'deal_window_invalid (422, выберите окончание в ближайшие 24 часа),',
          'deal_exists (409, на позицию уже есть горящее предложение, измените или снимите его),',
          `${NO_VENUE}, ${BAD_INPUT}.`,
        ].join(' '),
        security: bearerSecurity,
        body: DealBody,
        response: {
          201: success('Предложение выставлено', DealSchema),
          ...errorResponses(400, 401, 404, 409, 413, 415, 422),
        },
      },
    },
    async (request, reply) => {
      const { endsAt, ...input } = request.body;
      const created = await deals.create(userId(request), { ...input, endsAt: new Date(endsAt) });
      return reply.code(201).send(toDeal(created));
    },
  );

  app.patch(
    '/venue/deals/:id',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'updateDeal',
        tags: ['venue'],
        summary: 'Изменить горящее предложение',
        description: [
          'Меняет остаток порций или время окончания, нужно хотя бы одно поле.',
          'Коды ошибок: deal_not_found (404, предложение принадлежит другому заведению или не существует),',
          'deal_finished (409, предложение снято, его время вышло или позиция удалена, выставьте новое),',
          'deal_exists (409, вернуть порции распроданному предложению нельзя: на позицию уже выставлено новое),',
          'menu_item_unavailable (422, чтобы вернуть порции распроданному предложению, сначала включите позицию),',
          'deal_price_not_lower (422, цена в меню стала не выше цены предложения, выставьте новое предложение),',
          'deal_quantity_invalid (422, остаток не может быть больше quantityTotal),',
          `deal_window_invalid (422, выберите окончание в ближайшие 24 часа), ${NO_VENUE}, ${BAD_INPUT}.`,
        ].join(' '),
        security: bearerSecurity,
        params: IdParams,
        body: DealPatchBody,
        response: {
          200: success('Предложение изменено', DealSchema),
          ...errorResponses(400, 401, 404, 409, 413, 415, 422),
        },
      },
    },
    async (request) => {
      const { quantityLeft, endsAt } = request.body;
      const updated = await deals.update(userId(request), request.params.id, {
        quantityLeft,
        endsAt: endsAt === undefined ? undefined : new Date(endsAt),
      });
      return toDeal(updated);
    },
  );

  app.delete(
    '/venue/deals/:id',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'cancelDeal',
        tags: ['venue'],
        summary: 'Снять горящее предложение',
        description: [
          'Снимает идущее или запланированное предложение с продажи. Уже оформленные брони действуют.',
          'Распроданное, закончившееся или уже снятое предложение не меняется, ответ тоже 204.',
          'Коды ошибок: deal_not_found (404, предложение принадлежит другому заведению или не существует),',
          `${NO_VENUE}, ${BAD_ID}.`,
        ].join(' '),
        security: bearerSecurity,
        params: IdParams,
        response: { 204: noContent('Предложение снято'), ...errorResponses(400, 401, 404) },
      },
    },
    async (request, reply) => {
      await deals.cancel(userId(request), request.params.id);
      return reply.code(204).send(null);
    },
  );

  done();
};
