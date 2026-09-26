import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { z } from 'zod';

const DATA_API_FILE_NAME = 'DATA-API.yaml';
export const ACCOUNT_ROLES = ['guest', 'venue'] as const;
const CHECK_ROLES = [...ACCOUNT_ROLES, 'anonymous'] as const;
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export const EACH_ITEM = '[]';

const FIELD_PATH = /^[A-Za-z_]\w*(\[\])?(\.[A-Za-z_]\w*(\[\])?)*$/;
const SUBSTITUTION = /^\$\{([A-Z][A-Z0-9_]*)\}$/;

const scalar = z.union([z.string(), z.number(), z.boolean()]);

const accountSchema = z.strictObject({
  role: z.enum(ACCOUNT_ROLES),
  userId: z.int(),
  description: z.string().min(1),
  auth: z.strictObject({
    type: z.literal('bearer'),
    header: z.string().min(1),
    token: z.string().min(1),
  }),
});

const expectationSchema = z.strictObject({
  status: z.int().min(100).max(599),
  contentType: z.string().min(1),
  requiredFields: z.array(z.string().regex(FIELD_PATH)),
});

const checkSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  title: z.string().min(1),
  method: z.enum(HTTP_METHODS),
  path: z.string().regex(/^\/\S*$/),
  role: z.enum(CHECK_ROLES),
  params: z.strictObject({
    path: z.record(z.string(), scalar),
    query: z.record(z.string(), scalar),
    headers: z.record(z.string(), z.string()),
    body: z.record(z.string(), z.json()).nullable(),
  }),
  expect: z.array(expectationSchema).min(1),
});

export const dataApiSchema = z.strictObject({
  version: z.literal('1.0'),
  solution: z.strictObject({
    name: z.string().min(1),
    team: z.string().min(1),
    repository: z.url({ protocol: /^https$/ }),
  }),
  baseUrl: z.url({ protocol: /^https$/ }),
  openapi: z.string().min(1),
  accounts: z.array(accountSchema).min(1),
  testData: z.array(z.strictObject({ path: z.string().min(1), description: z.string().min(1) })).min(1),
  checks: z.array(checkSchema).min(1),
});

export type DataApi = z.infer<typeof dataApiSchema>;
export type DataApiCheck = DataApi['checks'][number];

export function parseDataApi(text: string): DataApi {
  return dataApiSchema.parse(parse(text));
}

export function findRepoFile(name: string, from: URL = new URL('.', import.meta.url)): URL {
  let dir = from;
  let candidate = new URL(name, dir);
  while (!existsSync(candidate)) {
    const parent = new URL('..', dir);
    if (parent.href === dir.href) throw new Error(`${name} is not found in ${from.href} or its parents`);
    dir = parent;
    candidate = new URL(name, dir);
  }
  return candidate;
}

export function dataApiFile(): URL {
  return findRepoFile(DATA_API_FILE_NAME);
}

export function loadDataApi(file: URL = dataApiFile()): DataApi {
  return parseDataApi(readFileSync(file, 'utf8'));
}

export function substitutionName(value: string): string | undefined {
  return SUBSTITUTION.exec(value)?.[1];
}

export function splitFieldPath(path: string): string[] {
  if (!FIELD_PATH.test(path)) throw new Error(`Invalid field path: ${path}`);
  return path
    .split('.')
    .flatMap((part) => (part.endsWith(EACH_ITEM) ? [part.slice(0, -EACH_ITEM.length), EACH_ITEM] : [part]));
}
