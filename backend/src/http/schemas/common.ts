import { STATUS_CODES } from 'node:http';
import { z } from 'zod';

export const ProblemSchema = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    code: z.string().describe('Машиночитаемый код ошибки'),
    detail: z.string(),
    errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  })
  .meta({ id: 'Problem', description: 'Описание ошибки по RFC 9457' });

export type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 413 | 415 | 422 | 429 | 500 | 503;

function problemResponse(status: ErrorStatus) {
  return {
    description: STATUS_CODES[status] ?? 'Error',
    content: { 'application/problem+json': { schema: ProblemSchema } },
  };
}

type ProblemResponses<Codes extends ErrorStatus> = Record<Codes, ReturnType<typeof problemResponse>>;

function responses<Codes extends ErrorStatus>(codes: readonly Codes[]): ProblemResponses<Codes> {
  return Object.fromEntries(codes.map((code) => [code, problemResponse(code)])) as ProblemResponses<Codes>;
}

export function errorResponses<const Codes extends ErrorStatus[]>(...codes: Codes) {
  return responses<Codes[number] | 429 | 500>([...codes, 429, 500]);
}

export function probeErrorResponses<const Codes extends ErrorStatus[]>(...codes: Codes) {
  return responses<Codes[number] | 500>([...codes, 500]);
}

export function success<Schema extends z.ZodType>(description: string, schema: Schema) {
  return { description, content: { 'application/json': { schema } } };
}

export function noContent(description: string) {
  return z.null().describe(description);
}

export const IsoDateTime = z
  .string()
  .meta({ format: 'date-time', examples: ['2026-09-25T12:00:00.000Z'] })
  .describe('Дата и время в формате ISO 8601, UTC');

export const GeoPointSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
  })
  .meta({ id: 'GeoPoint', description: 'Координаты WGS 84' });

export const IdParams = z.object({ id: z.coerce.number().int().positive() });

export function iso(date: Date): string {
  return date.toISOString();
}

export function isoOrNull(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

export const STANDARD_ERROR_HEADERS = {
  401: {
    'WWW-Authenticate': {
      description: 'Схема аутентификации Bearer',
      schema: { type: 'string' },
    },
  },
  429: {
    'Retry-After': {
      description: 'Через сколько секунд можно повторить запрос',
      schema: { type: 'integer' },
    },
  },
} as const;
