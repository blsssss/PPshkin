import SwaggerParser from '@apidevtools/swagger-parser';
import { readFile } from 'node:fs/promises';
import type { OpenAPIV3_1 } from 'openapi-types';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { OPENAPI_FILE, renderOpenApiYaml } from './openapi-document.ts';
import { tidyDocument } from './openapi.ts';

const rendered = await renderOpenApiYaml();
const document = parse(rendered) as OpenAPIV3_1.Document;

const operations = Object.entries(document.paths ?? {}).flatMap(([path, item]) =>
  (['get', 'post', 'put', 'patch', 'delete'] as const)
    .filter((method) => item?.[method])
    .map((method) => ({ path, method, operation: item?.[method] as OpenAPIV3_1.OperationObject })),
);

describe('OpenAPI document', () => {
  it('matches the committed openapi.yaml, run "npm run openapi" after changing routes', async () => {
    const committed = await readFile(OPENAPI_FILE, 'utf8');
    expect(committed).toBe(rendered);
  });

  it('is a valid OpenAPI 3.1 document', async () => {
    await expect(SwaggerParser.validate(structuredClone(document))).resolves.toBeDefined();
    expect(document.openapi).toBe('3.1.0');
  });

  it('documents every operation with a tag, a summary and an error shape', () => {
    expect(operations.length).toBeGreaterThan(0);
    for (const { path, method, operation } of operations) {
      const label = `${method.toUpperCase()} ${path}`;
      expect(operation.tags, label).toHaveLength(1);
      expect(operation.summary, label).toBeTruthy();
      if (path.startsWith('/api/')) {
        const statuses = Object.keys(operation.responses ?? {});
        expect(
          statuses.some((status) => status.startsWith('4')),
          label,
        ).toBe(true);
      }
    }
  });

  it('protects every API operation except sign in', () => {
    const open = operations
      .filter(({ path }) => path.startsWith('/api/'))
      .filter(({ operation }) => !operation.security?.length)
      .map(({ method, path }) => `${method.toUpperCase()} ${path}`);
    expect(open).toEqual(['POST /api/v1/auth/max']);
  });
});

describe('tidyDocument', () => {
  it('drops unreachable schemas and safe integer bounds but keeps transitive references', () => {
    const tidy = tidyDocument({
      paths: { '/a': { get: { responses: { 200: { $ref: '#/components/schemas/A' } } } } },
      components: {
        schemas: {
          A: { properties: { b: { $ref: '#/components/schemas/B' } } },
          B: { type: 'integer', minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER },
          AInput: { type: 'object' },
        },
      },
    });
    expect(Object.keys(tidy.components.schemas)).toEqual(['A', 'B']);
    expect(tidy.components.schemas.B).toEqual({ type: 'integer' });
  });
});
