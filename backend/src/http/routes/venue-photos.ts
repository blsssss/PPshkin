import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import type { PhotosService } from '../../services/photos.ts';
import { bearerSecurity, requireAuth, venueActor } from '../auth.ts';
import { errorResponses, IdParams, success } from '../schemas/common.ts';
import { MenuItemSchema, toMenuItem } from '../schemas/menu.ts';
import { toVenue, VenueQuery, VenueSchema } from '../schemas/venues.ts';
import { IMAGE_UPLOAD_ERROR_STATUSES, readImageUpload } from '../uploads.ts';

interface VenuePhotoRouteOptions {
  photos: PhotosService;
}

const UPLOADS_PER_MINUTE = 20;

const NO_VENUE =
  'venue_not_found (404, заведения ещё нет или оно не из ваших рабочих мест), venue_required (400, у вас несколько заведений, передайте venueId), venue_forbidden (403, роль не позволяет это действие)';
const UPLOAD_ERRORS = [
  'image_required, image_empty, invalid_multipart (400, приложите одно фото в поле image),',
  'image_too_large, upload_too_many_parts (413, пришлите одно фото до 5 МБ),',
  'multipart_required, unsupported_image_type (415, пришлите JPEG, PNG или WebP),',
  'image_unreadable (422, файл не удалось разобрать или сторона меньше 100 px)',
].join(' ');
const PHOTO_RULES =
  'Фото в multipart/form-data, поле image: JPEG, PNG или WebP до 5 МБ, тип определяется по содержимому. На сервере фото перекодируется в WebP без метаданных (EXIF и GPS удаляются), делаются размеры 640 и 1280 px по ширине. Новое фото заменяет прежнее.';

export const venuePhotoRoutes: FastifyPluginCallbackZod<VenuePhotoRouteOptions> = (app, { photos }, done) => {
  app.put(
    '/venue/photo',
    {
      preValidation: requireAuth,
      config: { imageUpload: true, rateLimit: { max: UPLOADS_PER_MINUTE, timeWindow: '1 minute' } },
      schema: {
        operationId: 'setVenuePhoto',
        tags: ['venue'],
        summary: 'Загрузить или заменить фото заведения',
        description: `${PHOTO_RULES} Нужно право venue.edit. Коды ошибок: ${UPLOAD_ERRORS}, ${NO_VENUE}.`,
        security: bearerSecurity,
        querystring: VenueQuery,
        response: {
          200: success('Заведение с адресом фото в photoUrl', VenueSchema),
          ...errorResponses(...IMAGE_UPLOAD_ERROR_STATUSES, 401, 403, 404, 422),
        },
      },
    },
    async (request) => {
      const upload = await readImageUpload(request);
      return toVenue(
        await photos.setVenuePhoto(venueActor(request, request.query.venueId), upload.data, 'miniapp'),
      );
    },
  );

  app.delete(
    '/venue/photo',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'removeVenuePhoto',
        tags: ['venue'],
        summary: 'Удалить фото заведения',
        description: `Файл удаляется с сервера, если им не пользуется другая запись. Без фото операция ничего не меняет. Нужно право venue.edit. Коды ошибок: ${NO_VENUE}.`,
        security: bearerSecurity,
        querystring: VenueQuery,
        response: {
          200: success('Заведение, photoUrl равен null', VenueSchema),
          ...errorResponses(400, 401, 403, 404),
        },
      },
    },
    async (request) =>
      toVenue(await photos.removeVenuePhoto(venueActor(request, request.query.venueId), 'miniapp')),
  );

  app.put(
    '/venue/menu/items/:id/photo',
    {
      preValidation: requireAuth,
      config: { imageUpload: true, rateLimit: { max: UPLOADS_PER_MINUTE, timeWindow: '1 minute' } },
      schema: {
        operationId: 'setMenuItemPhoto',
        tags: ['venue'],
        summary: 'Загрузить или заменить фото позиции меню',
        description: `${PHOTO_RULES} Фото показывается и в горящем предложении на эту позицию. Нужно право menu.edit. Коды ошибок: menu_item_not_found (404, позиции нет или она из другого заведения), ${UPLOAD_ERRORS}, ${NO_VENUE}.`,
        security: bearerSecurity,
        querystring: VenueQuery,
        params: IdParams,
        response: {
          200: success('Позиция с адресом фото в photoUrl', MenuItemSchema),
          ...errorResponses(...IMAGE_UPLOAD_ERROR_STATUSES, 401, 403, 404, 422),
        },
      },
    },
    async (request) => {
      const upload = await readImageUpload(request);
      return toMenuItem(
        await photos.setMenuItemPhoto(
          venueActor(request, request.query.venueId),
          request.params.id,
          upload.data,
          'miniapp',
        ),
      );
    },
  );

  app.delete(
    '/venue/menu/items/:id/photo',
    {
      preValidation: requireAuth,
      schema: {
        operationId: 'removeMenuItemPhoto',
        tags: ['venue'],
        summary: 'Удалить фото позиции меню',
        description: `Файл удаляется с сервера, если им не пользуется другая запись. Нужно право menu.edit. Коды ошибок: menu_item_not_found (404, позиции нет или она из другого заведения), ${NO_VENUE}.`,
        security: bearerSecurity,
        querystring: VenueQuery,
        params: IdParams,
        response: {
          200: success('Позиция, photoUrl равен null', MenuItemSchema),
          ...errorResponses(400, 401, 403, 404),
        },
      },
    },
    async (request) =>
      toMenuItem(
        await photos.removeMenuItemPhoto(
          venueActor(request, request.query.venueId),
          request.params.id,
          'miniapp',
        ),
      ),
  );

  done();
};
