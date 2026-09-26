import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';
import { jsonSchemaTransform, jsonSchemaTransformObject } from 'fastify-type-provider-zod';
import { STANDARD_ERROR_HEADERS } from './schemas/common.ts';
import { IMAGE_UPLOAD_BODY } from './uploads.ts';

export const API_VERSION = '1.0.0';

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null;
}

function dropSafeIntegerBounds(node: unknown): void {
  if (Array.isArray(node)) {
    node.forEach(dropSafeIntegerBounds);
    return;
  }
  if (!isObject(node)) return;
  if (node.minimum === Number.MIN_SAFE_INTEGER) delete node.minimum;
  if (node.maximum === Number.MAX_SAFE_INTEGER) delete node.maximum;
  Object.values(node).forEach(dropSafeIntegerBounds);
}

function collectRefs(node: unknown, into: Set<string>): void {
  if (Array.isArray(node)) {
    node.forEach((item) => {
      collectRefs(item, into);
    });
    return;
  }
  if (!isObject(node)) return;
  const ref = node.$ref;
  if (typeof ref === 'string' && ref.startsWith('#/components/schemas/')) {
    into.add(ref.slice('#/components/schemas/'.length));
  }
  Object.values(node).forEach((value) => {
    collectRefs(value, into);
  });
}

function addStandardHeaders(paths: unknown): void {
  if (!isObject(paths)) return;
  for (const item of Object.values(paths)) {
    if (!isObject(item)) continue;
    for (const operation of Object.values(item)) {
      if (!isObject(operation) || !isObject(operation.responses)) continue;
      for (const [status, headers] of Object.entries(STANDARD_ERROR_HEADERS)) {
        const response = operation.responses[status];
        if (isObject(response)) response.headers = headers;
      }
    }
  }
}

export function tidyDocument<T extends object>(document: T): T {
  dropSafeIntegerBounds(document);
  addStandardHeaders((document as Json).paths);
  const root = document as Json;
  const components = isObject(root.components) ? root.components : undefined;
  const schemas = components && isObject(components.schemas) ? components.schemas : undefined;
  if (!components || !schemas) return document;
  const reachable = new Set<string>();
  collectRefs(root.paths, reachable);
  let frontier = [...reachable];
  while (frontier.length > 0) {
    const next = new Set<string>();
    for (const name of frontier) collectRefs(schemas[name], next);
    frontier = [...next].filter((name) => !reachable.has(name));
    frontier.forEach((name) => reachable.add(name));
  }
  components.schemas = Object.fromEntries(Object.entries(schemas).filter(([name]) => reachable.has(name)));
  return document;
}

export const API_TAGS = [
  { name: 'system', description: 'Состояние сервиса' },
  { name: 'auth', description: 'Вход через MAX' },
  { name: 'me', description: 'Профиль текущего пользователя' },
  { name: 'consents', description: 'Согласия на обработку данных и персональные предложения' },
  { name: 'diary', description: 'Дневник питания' },
  { name: 'venue', description: 'Кабинет заведения' },
  { name: 'catalog', description: 'Заведения и горящие предложения рядом' },
  { name: 'recommendations', description: 'Подбор блюд рядом и обратная связь' },
  { name: 'insights', description: 'Профиль пищевого поведения' },
  { name: 'bookings', description: 'Брони гостя' },
];

export async function registerOpenApi(app: FastifyInstance) {
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'PPshkin API',
        version: API_VERSION,
        description:
          'HTTP API мини-приложения ППшкин в MAX. Гость ведёт дневник питания и получает персональные предложения заведений, заведение управляет меню, горящими позициями и бронями.',
      },
      servers: [{ url: '/', description: 'Текущий хост' }],
      tags: API_TAGS,
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            description:
              'Сессионный токен из POST /api/v1/auth/max или тестовый токен демо-учётки (только при DEMO_MODE=true).',
          },
        },
      },
    },
    transform: (input) => {
      const output = jsonSchemaTransform(input);
      if (!input.route.config?.imageUpload) return output;
      return {
        ...output,
        schema: { ...output.schema, consumes: ['multipart/form-data'], body: IMAGE_UPLOAD_BODY },
      };
    },
    transformObject: (input) => tidyDocument(jsonSchemaTransformObject(input)),
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });
}
