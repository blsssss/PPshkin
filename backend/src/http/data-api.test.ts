import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  ACCOUNT_ROLES,
  EACH_ITEM,
  dataApiFile,
  dataApiSchema,
  findRepoFile,
  loadDataApi,
  parseDataApi,
  splitFieldPath,
  substitutionName,
  type DataApiCheck,
} from '../../test/data-api.ts';
import { DEMO_ACCOUNTS } from '../auth/demo.ts';
import { configSchema } from '../config.ts';
import { OPENAPI_FILE } from './openapi-document.ts';

type Json = Record<string, unknown>;

interface Parameter {
  name: string;
  location: string;
  required: boolean;
  schema: string[];
}

const file = dataApiFile();
const dataApi = loadDataApi(file);
const openapi = parse(readFileSync(OPENAPI_FILE, 'utf8')) as Json;
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats.default(ajv);
ajv.addSchema(openapi, 'openapi');

const COMBINATORS = ['allOf', 'oneOf', 'anyOf'] as const;
const MAIN_SCENARIO_OPERATIONS = [
  'getRecommendations',
  'createBooking',
  'redeemBooking',
  'getVenueAnalytics',
];
const MINIMAL_CHECKS = [
  'health GET /health anonymous',
  'unauthorized GET /api/v1/me anonymous',
  'guest-profile GET /api/v1/me guest',
  'guest-diary-today GET /api/v1/diary/today guest',
  'guest-meal-manual POST /api/v1/diary/meals guest',
  'guest-meal-invalid POST /api/v1/diary/meals guest',
  'guest-meal-text POST /api/v1/diary/meals/text guest',
  'guest-insights GET /api/v1/insights guest',
  'guest-recommendations GET /api/v1/recommendations guest',
  'guest-venues GET /api/v1/venues guest',
  'guest-deals GET /api/v1/deals guest',
  'guest-venue-card GET /api/v1/venues/{id} guest',
  'guest-booking-create POST /api/v1/bookings guest',
  'guest-bookings GET /api/v1/bookings guest',
  'venue-profile GET /api/v1/venue venue',
  'venue-menu GET /api/v1/venue/menu venue',
  'venue-deals GET /api/v1/venue/deals venue',
  'venue-bookings GET /api/v1/venue/bookings venue',
  'venue-redeem-unknown POST /api/v1/venue/bookings/redeem venue',
  'venue-analytics GET /api/v1/venue/analytics venue',
];

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function at(root: unknown, pointer: readonly string[]): unknown {
  return pointer.reduce<unknown>(
    (node, key) =>
      typeof node === 'object' && node !== null && Object.hasOwn(node, key) ? (node as Json)[key] : undefined,
    root,
  );
}

function refPointer(ref: string): string[] {
  if (!ref.startsWith('#/')) throw new Error(`Only local references are supported: ${ref}`);
  return ref
    .slice(2)
    .split('/')
    .map((key) => key.replaceAll('~1', '/').replaceAll('~0', '~'));
}

function follow(root: unknown, pointer: string[]): string[] {
  const node = at(root, pointer);
  return isObject(node) && typeof node.$ref === 'string' ? follow(root, refPointer(node.$ref)) : pointer;
}

function variants(root: unknown, schema: Json, seen: Set<Json>): Json[] {
  if (seen.has(schema)) return [];
  seen.add(schema);
  const referenced = typeof schema.$ref === 'string' ? [at(root, refPointer(schema.$ref))] : [];
  const nested = COMBINATORS.flatMap((keyword) => {
    const list = schema[keyword];
    return Array.isArray(list) ? (list as unknown[]) : [];
  });
  return [
    schema,
    ...[...referenced, ...nested].filter(isObject).flatMap((child) => variants(root, child, seen)),
  ];
}

function schemaHasField(root: unknown, schema: Json, segments: readonly string[]): boolean {
  let current = [schema];
  for (const segment of segments) {
    current = current
      .flatMap((node) => variants(root, node, new Set()))
      .map((variant) => (segment === EACH_ITEM ? variant.items : at(variant, ['properties', segment])))
      .filter(isObject);
    if (current.length === 0) return false;
  }
  return true;
}

const operationPointer = (check: DataApiCheck) => ['paths', check.path, check.method.toLowerCase()];

function operationOf(check: DataApiCheck): Json | undefined {
  const operation = at(openapi, operationPointer(check));
  return isObject(operation) ? operation : undefined;
}

const responsePointer = (check: DataApiCheck, status: number) =>
  follow(openapi, [...operationPointer(check), 'responses', String(status)]);

const requestBodyPointer = (check: DataApiCheck) =>
  follow(openapi, [...operationPointer(check), 'requestBody']);

const jsonBodySchemaPointer = (check: DataApiCheck) => [
  ...requestBodyPointer(check),
  'content',
  'application/json',
  'schema',
];

function isProtected(operation: Json): boolean {
  const security = operation.security ?? openapi.security;
  return (
    Array.isArray(security) &&
    security.length > 0 &&
    security.every((requirement) => isObject(requirement) && Object.keys(requirement).length > 0)
  );
}

function parametersOf(check: DataApiCheck): Parameter[] {
  const base = [...operationPointer(check), 'parameters'];
  const list = at(openapi, base);
  return (Array.isArray(list) ? list : []).map((_, index) => {
    const pointer = follow(openapi, [...base, String(index)]);
    const parameter = at(openapi, pointer);
    if (!isObject(parameter) || typeof parameter.name !== 'string' || typeof parameter.in !== 'string') {
      throw new Error(`Malformed parameter at ${pointer.join('/')}`);
    }
    return {
      name: parameter.name,
      location: parameter.in,
      required: parameter.required === true,
      schema: [...pointer, 'schema'],
    };
  });
}

function validationError(pointer: string[], value: unknown): string | null {
  const id = `openapi#/${pointer.map((key) => key.replaceAll('~', '~0').replaceAll('/', '~1')).join('/')}`;
  const validate = ajv.getSchema(id);
  if (!validate) throw new Error(`No schema at ${id}`);
  return validate(value) ? null : ajv.errorsText(validate.errors);
}

function requestShapeProblems(check: DataApiCheck, parameters: Parameter[]): string[] {
  const templated = [...check.path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1] ?? '');
  const documented = (location: string) =>
    parameters.filter((parameter) => parameter.location === location).map((parameter) => parameter.name);
  return [
    ...templated
      .filter((name) => !documented('path').includes(name))
      .map((name) => `path parameter {${name}} is not documented`),
    ...templated
      .filter((name) => !Object.hasOwn(check.params.path, name))
      .map((name) => `path parameter {${name}} has no value`),
    ...Object.keys(check.params.path)
      .filter((name) => !templated.includes(name))
      .map((name) => `path parameter ${name} is not in the path template`),
    ...Object.keys(check.params.query)
      .filter((name) => !documented('query').includes(name))
      .map((name) => `query parameter ${name} is not documented`),
    ...(check.params.body !== null && !isObject(at(openapi, jsonBodySchemaPointer(check)))
      ? ['the operation takes no application/json body']
      : []),
  ];
}

function requestValueProblems(check: DataApiCheck, parameters: Parameter[]): string[] {
  const values: Record<string, Record<string, unknown>> = {
    path: check.params.path,
    query: check.params.query,
  };
  const problems = parameters.flatMap((parameter) => {
    const provided = values[parameter.location];
    if (!provided) return [];
    if (!Object.hasOwn(provided, parameter.name)) {
      return parameter.required
        ? [`required ${parameter.location} parameter ${parameter.name} is missing`]
        : [];
    }
    const error = validationError(parameter.schema, provided[parameter.name]);
    return error ? [`${parameter.location} parameter ${parameter.name}: ${error}`] : [];
  });
  const requestBody = at(openapi, requestBodyPointer(check));
  if (check.params.body === null) {
    if (isObject(requestBody) && requestBody.required === true) problems.push('the required body is missing');
  } else if (isObject(at(openapi, jsonBodySchemaPointer(check)))) {
    const error = validationError(jsonBodySchemaPointer(check), check.params.body);
    if (error) problems.push(`body: ${error}`);
  }
  return problems;
}

function problemsOf(inspect: (check: DataApiCheck, operation: Json) => string[]): string[] {
  return dataApi.checks.flatMap((check) => {
    const operation = operationOf(check);
    return operation ? inspect(check, operation).map((problem) => `${check.id}: ${problem}`) : [];
  });
}

describe('DATA-API.yaml', () => {
  it('describes the solution in the contract format', () => {
    expect(dataApi.version).toBe('1.0');
    expect(dataApi.solution).toEqual({
      name: 'ППшкин',
      team: 'Mikkkin',
      repository: 'https://github.com/blsssss/PPshkin',
    });
    expect(new URL(dataApi.openapi, file).href).toBe(OPENAPI_FILE.href);
  });

  it('points at an https base URL without a trailing slash', () => {
    expect(dataApi.baseUrl).toMatch(/^https:\/\/[^/]/);
    expect(dataApi.baseUrl).not.toMatch(/\/$/);
  });

  it('keeps tokens out of the file as ${...} substitutions of config variables', () => {
    const configKeys = Object.keys(configSchema.shape);
    const variables = dataApi.accounts.map((account) => substitutionName(account.auth.token));
    expect(variables.filter((name) => name === undefined || !configKeys.includes(name))).toEqual([]);
    const authHeaders = new Set(dataApi.accounts.map((account) => account.auth.header.toLowerCase()));
    const manual = dataApi.checks.filter((check) =>
      Object.keys(check.params.headers).some((header) => authHeaders.has(header.toLowerCase())),
    );
    expect(manual.map((check) => check.id)).toEqual([]);
  });

  it('describes the demo accounts from backend/testdata/accounts.json', () => {
    const demoAccounts = JSON.parse(
      readFileSync(new URL('../../testdata/accounts.json', import.meta.url), 'utf8'),
    ) as { role: string; userId: number; tokenEnv: string }[];
    expect(
      dataApi.accounts.map((account) => ({
        role: account.role,
        userId: account.userId,
        tokenEnv: substitutionName(account.auth.token),
        header: account.auth.header,
      })),
    ).toEqual(
      demoAccounts.map(({ role, userId, tokenEnv }) => ({ role, userId, tokenEnv, header: 'Authorization' })),
    );
    expect(dataApi.accounts.map((account) => account.userId)).toEqual(
      dataApi.accounts.map((account) => DEMO_ACCOUNTS[account.role].userId),
    );
  });

  it('lists test data files that exist in the repository', () => {
    const root = new URL('.', file).href;
    const missing = dataApi.testData
      .map((entry) => entry.path)
      .filter((path) => {
        const url = new URL(path, file);
        return !url.href.startsWith(root) || !existsSync(url) || !statSync(url).isFile();
      });
    expect(missing).toEqual([]);
  });

  it('has unique check ids and no repeated statuses within a check', () => {
    const ids = dataApi.checks.map((check) => check.id);
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
    const repeated = dataApi.checks.filter(
      (check) => new Set(check.expect.map(({ status }) => status)).size !== check.expect.length,
    );
    expect(repeated.map((check) => check.id)).toEqual([]);
  });

  it('runs every check as a declared account or anonymously', () => {
    const roles = new Set<string>(dataApi.accounts.map((account) => account.role));
    const unknown = dataApi.checks.filter((check) => check.role !== 'anonymous' && !roles.has(check.role));
    expect(unknown.map((check) => check.id)).toEqual([]);
  });

  it('contains the minimal set of checks', () => {
    const present = dataApi.checks.map((check) => `${check.id} ${check.method} ${check.path} ${check.role}`);
    expect(MINIMAL_CHECKS.filter((check) => !present.includes(check))).toEqual([]);
  });

  it('covers both roles and the operations of the main scenario', () => {
    const roles = new Set<string>(dataApi.checks.map((check) => check.role));
    expect(ACCOUNT_ROLES.filter((role) => !roles.has(role))).toEqual([]);
    const operationIds = new Set(dataApi.checks.map((check) => operationOf(check)?.operationId));
    expect(MAIN_SCENARIO_OPERATIONS.filter((id) => !operationIds.has(id))).toEqual([]);
  });

  it('calls only operations documented in openapi.yaml', () => {
    const missing = dataApi.checks.filter((check) => !operationOf(check));
    expect(missing.map((check) => `${check.id}: ${check.method} ${check.path}`)).toEqual([]);
  });

  it('expects only documented statuses with the documented content type', () => {
    const problems = problemsOf((check) =>
      check.expect.flatMap(({ status, contentType }) => {
        const response = at(openapi, responsePointer(check, status));
        if (!isObject(response)) return [`status ${status} is not documented`];
        return isObject(at(response, ['content', contentType]))
          ? []
          : [`status ${status} is not documented as ${contentType}`];
      }),
    );
    expect(problems).toEqual([]);
  });

  it('requires only fields of the documented response schemas', () => {
    const problems = problemsOf((check) =>
      check.expect.flatMap(({ status, contentType, requiredFields }) => {
        const schema = at(openapi, [...responsePointer(check, status), 'content', contentType, 'schema']);
        if (!isObject(schema)) {
          return requiredFields.length > 0 ? [`status ${status} ${contentType} has no schema`] : [];
        }
        return requiredFields
          .filter((field) => !schemaHasField(openapi, schema, splitFieldPath(field)))
          .map((field) => `status ${status}: ${field} is not in the response schema`);
      }),
    );
    expect(problems).toEqual([]);
  });

  it('sends the parameters and the body the operation documents', () => {
    const problems = problemsOf((check) => {
      const parameters = parametersOf(check);
      const shape = requestShapeProblems(check, parameters);
      const invalid = requestValueProblems(check, parameters);
      if (!check.expect.every(({ status }) => status === 400)) return [...shape, ...invalid];
      return invalid.length > 0 ? shape : [...shape, 'expects only 400, but the request matches the schema'];
    });
    expect(problems).toEqual([]);
  });

  it('calls protected operations anonymously only to expect 401', () => {
    const problems = problemsOf((check, operation) => {
      if (check.role !== 'anonymous' || !isProtected(operation)) return [];
      const statuses = check.expect.map(({ status }) => status);
      return statuses.length === 1 && statuses[0] === 401
        ? []
        : [`anonymous call of a protected operation expects ${statuses.join(', ')} instead of only 401`];
    });
    expect(problems).toEqual([]);
  });

  it('avoids long dash characters', () => {
    const text = readFileSync(file, 'utf8');
    const longDashes = [String.fromCodePoint(0x2013), String.fromCodePoint(0x2014)];
    expect(longDashes.filter((dash) => text.includes(dash))).toEqual([]);
  });
});

describe('DATA-API.yaml schema', () => {
  const withCheck = (patch: Json) => ({ ...dataApi, checks: [{ ...dataApi.checks[0], ...patch }] });

  it('rejects unknown keys, other versions and plain http', () => {
    expect(dataApiSchema.safeParse(dataApi).success).toBe(true);
    expect(dataApiSchema.safeParse({ ...dataApi, extra: true }).success).toBe(false);
    expect(dataApiSchema.safeParse({ ...dataApi, version: '2.0' }).success).toBe(false);
    expect(dataApiSchema.safeParse({ ...dataApi, baseUrl: 'http://ppshkin.example.com' }).success).toBe(
      false,
    );
  });

  it('rejects unknown roles, empty expectations and malformed field paths', () => {
    expect(dataApiSchema.safeParse(withCheck({ role: 'admin' })).success).toBe(false);
    expect(dataApiSchema.safeParse(withCheck({ expect: [] })).success).toBe(false);
    const expectation = { status: 200, contentType: 'application/json', requiredFields: ['items[0]'] };
    expect(dataApiSchema.safeParse(withCheck({ expect: [expectation] })).success).toBe(false);
  });

  it('rejects duplicate YAML keys', () => {
    expect(() => parseDataApi('version: "1.0"\nversion: "1.0"\n')).toThrow();
  });
});

describe('data API helpers', () => {
  it('splits field paths into properties and array items', () => {
    expect(splitFieldPath('status')).toEqual(['status']);
    expect(splitFieldPath('items[].offerId')).toEqual(['items', EACH_ITEM, 'offerId']);
    expect(splitFieldPath('byDay[]')).toEqual(['byDay', EACH_ITEM]);
    expect(splitFieldPath('venue.location.lat')).toEqual(['venue', 'location', 'lat']);
  });

  it('rejects malformed field paths', () => {
    for (const path of ['', '.items', 'items.', 'items..id', 'items[0]', 'items[]x', 'items[][]', '1st']) {
      expect(() => splitFieldPath(path), path).toThrow(/Invalid field path/);
    }
  });

  it('reads only ${NAME} substitutions', () => {
    expect(substitutionName('${DEMO_GUEST_TOKEN}')).toBe('DEMO_GUEST_TOKEN');
    for (const value of [
      'local-demo-guest-token-not-secret',
      '${demo_token}',
      'x${TOKEN}',
      '${TOKEN}x',
      '$TOKEN',
    ]) {
      expect(substitutionName(value), value).toBeUndefined();
    }
  });

  it('finds DATA-API.yaml in the repository root and fails on a missing file', () => {
    expect(file.href).toBe(new URL('DATA-API.yaml', OPENAPI_FILE).href);
    expect(() => findRepoFile('no-such-file.yaml')).toThrow(/no-such-file\.yaml is not found/);
  });
});

describe('response schema field resolver', () => {
  const root = {
    components: {
      schemas: {
        Item: { type: 'object', properties: { offerId: { type: 'integer' } } },
        Page: {
          type: 'object',
          properties: { items: { type: 'array', items: { $ref: '#/components/schemas/Item' } } },
        },
        Named: {
          allOf: [
            { $ref: '#/components/schemas/Page' },
            { type: 'object', properties: { name: { type: 'string' } } },
          ],
        },
        Either: {
          oneOf: [
            { type: 'object', properties: { ready: { type: 'boolean' } } },
            { anyOf: [{ type: 'object', properties: { reason: { type: 'string' } } }, { type: 'null' }] },
          ],
        },
        Loop: { type: 'object', properties: { next: { $ref: '#/components/schemas/Loop' } } },
      },
    },
  };
  const has = (name: string, path: string) =>
    schemaHasField(root, { $ref: `#/components/schemas/${name}` }, splitFieldPath(path));

  it('follows $ref, allOf, oneOf, anyOf and array items', () => {
    expect(has('Page', 'items')).toBe(true);
    expect(has('Page', 'items[].offerId')).toBe(true);
    expect(has('Named', 'name')).toBe(true);
    expect(has('Named', 'items[].offerId')).toBe(true);
    expect(has('Either', 'ready')).toBe(true);
    expect(has('Either', 'reason')).toBe(true);
    expect(has('Loop', 'next.next.next')).toBe(true);
  });

  it('rejects a missing nested field, a missing [] and [] on a scalar', () => {
    expect(has('Page', 'items[].missing')).toBe(false);
    expect(has('Page', 'items.offerId')).toBe(false);
    expect(has('Page', 'items[].offerId[]')).toBe(false);
    expect(has('Named', 'missing')).toBe(false);
    expect(has('Either', 'ready.value')).toBe(false);
    expect(has('Page', '__proto__')).toBe(false);
  });

  it('rejects a field that the real response schema does not have', () => {
    const schema = at(openapi, [
      ...follow(openapi, ['paths', '/api/v1/venue/analytics', 'get', 'responses', '200']),
      'content',
      'application/json',
      'schema',
    ]);
    if (!isObject(schema)) throw new Error('GET /api/v1/venue/analytics has no 200 schema');
    expect(schemaHasField(openapi, schema, splitFieldPath('byDay[].date'))).toBe(true);
    expect(schemaHasField(openapi, schema, splitFieldPath('byDay[].missing'))).toBe(false);
  });
});
