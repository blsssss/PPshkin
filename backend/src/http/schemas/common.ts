import { STATUS_CODES } from 'node:http';
import { z } from 'zod';

export const ProblemSchema = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    code: z.string().describe('Machine readable error code'),
    detail: z.string(),
    errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  })
  .meta({ id: 'Problem', description: 'RFC 9457 problem details' });

export type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 422 | 429 | 503;

export function errorResponses<const Codes extends ErrorStatus[]>(...codes: Codes) {
  return Object.fromEntries(
    codes.map((code) => [code, ProblemSchema.describe(STATUS_CODES[code] ?? 'Error')]),
  ) as Record<Codes[number], typeof ProblemSchema>;
}

export const IsoDateTime = z.iso.datetime({ offset: true }).describe('ISO 8601 date and time');

export const GeoPointSchema = z
  .object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
  })
  .meta({ id: 'GeoPoint' });

export const IdParams = z.object({ id: z.coerce.number().int().positive() });

export function iso(date: Date): string {
  return date.toISOString();
}

export function isoOrNull(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}
