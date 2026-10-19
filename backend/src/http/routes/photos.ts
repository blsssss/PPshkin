import type { FastifyPluginCallbackZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { PHOTO_SIZES } from '../../ports/photo-storage.ts';
import type { PhotosService } from '../../services/photos.ts';
import { notFound } from '../../shared/errors.ts';
import { errorResponses } from '../schemas/common.ts';

interface PhotoRouteOptions {
  photos: PhotosService;
}

const PhotoParams = z.object({
  file: z
    .string()
    .regex(/^[0-9a-f]{64}\.webp$/)
    .describe('Хэш фото из photoUrl и расширение .webp'),
});

const PhotoQuery = z.object({
  size: z.enum(PHOTO_SIZES).default('card').describe('card - 640 px по ширине, large - 1280 px'),
});

const PHOTOS_PER_MINUTE = 1200;

export const photoRoutes: FastifyPluginCallbackZod<PhotoRouteOptions> = (app, { photos }, done) => {
  app.get(
    '/photos/:file',
    {
      config: { rateLimit: { max: PHOTOS_PER_MINUTE, timeWindow: '1 minute' } },
      schema: {
        operationId: 'getPhoto',
        tags: ['photos'],
        summary: 'Фото заведения или позиции меню',
        description: [
          'Открытый метод без авторизации: фото еды и интерьера не персональные данные. Адрес берите из поля photoUrl, путь содержит только хэш содержимого и не раскрывает идентификаторы заведений.',
          'Ответ кэшируется на год (Cache-Control: public, max-age=31536000, immutable): при замене фото адрес меняется.',
          'Коды ошибок: photo_not_found (404, фото удалено или адрес неверный),',
          'validation_failed (400, адрес не из photoUrl или неизвестный size).',
        ].join(' '),
        params: PhotoParams,
        querystring: PhotoQuery,
        response: {
          200: {
            description: 'Изображение WebP',
            content: { 'image/webp': { schema: z.string().meta({ format: 'binary' }) } },
          },
          ...errorResponses(400, 404),
        },
      },
    },
    async (request, reply) => {
      const key = request.params.file.slice(0, -'.webp'.length);
      const data = await photos.read(key, request.query.size);
      if (!data) throw notFound('photo_not_found', 'Photo not found');
      return reply
        .header('Cache-Control', 'public, max-age=31536000, immutable')
        .header('X-Content-Type-Options', 'nosniff')
        .type('image/webp')
        .send(data as unknown as string);
    },
  );

  done();
};
