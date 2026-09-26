import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';
import type { LightMyRequestResponse } from 'fastify';
import { expect } from 'vitest';
import { parse } from 'yaml';
import { OPENAPI_FILE } from '../src/http/openapi-document.ts';

type Json = Record<string, unknown>;

const document = parse(readFileSync(OPENAPI_FILE, 'utf8')) as Json;
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats.default(ajv);
ajv.addSchema(document, 'openapi');

const isJson = (mediaType: string) => mediaType === 'application/json' || mediaType.endsWith('+json');

const escapePointer = (segment: string) => segment.replaceAll('~', '~0').replaceAll('/', '~1');

function operation(method: string, path: string): Json {
  const paths = document.paths as Record<string, Record<string, Json> | undefined>;
  const found = paths[path]?.[method.toLowerCase()];
  if (!found) throw new Error(`${method} ${path} is not in openapi.yaml`);
  return found;
}

export function expectContract(response: LightMyRequestResponse, method: string, path: string): void {
  const label = `${method} ${path} -> ${response.statusCode}`;
  const responses = operation(method, path).responses as Record<string, Json | undefined>;
  const documented = responses[String(response.statusCode)];
  expect(documented, `${label} is not documented`).toBeDefined();
  const content = documented?.content as Record<string, unknown> | undefined;
  if (!content) {
    expect(response.body, `${label} must have an empty body`).toBe('');
    return;
  }
  const header = response.headers['content-type'];
  const mediaType = (typeof header === 'string' ? header : '').split(';')[0]?.trim() ?? '';
  expect(Object.keys(content), `${label} content type`).toContain(mediaType);
  if (!isJson(mediaType)) return;
  const pointer = [
    'paths',
    path,
    method.toLowerCase(),
    'responses',
    String(response.statusCode),
    'content',
    mediaType,
    'schema',
  ]
    .map(escapePointer)
    .join('/');
  const validate = ajv.getSchema(`openapi#/${pointer}`);
  if (!validate) throw new Error(`No schema at ${pointer}`);
  const valid = validate(response.json());
  expect(valid, `${label} body: ${ajv.errorsText(validate.errors)}`).toBe(true);
}
