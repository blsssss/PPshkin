import { smokeCheck, SmokeFailure, type SmokeCheck, type SmokeContext } from './check.ts';
import {
  dataApiFile,
  EACH_ITEM,
  parseDataApi,
  splitFieldPath,
  substitutionName,
  type DataApi,
  type DataApiCheck,
} from './data-api.ts';
import {
  discard,
  mediaType,
  readJson,
  request,
  requireSecureTransport,
  withoutTrailingSlash,
} from './http.ts';

type Account = DataApi['accounts'][number];

interface Credentials {
  header: string;
  token: string;
}

const LISTED_FIELDS = 5;
const TOKEN_VARIABLES = ['DEMO_GUEST_TOKEN', 'DEMO_VENUE_TOKEN'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function tokenVariable(account: Account): string {
  const name = substitutionName(account.auth.token);
  if (name === undefined || !TOKEN_VARIABLES.includes(name)) {
    const allowed = TOKEN_VARIABLES.map((variable) => `\${${variable}}`).join(' or ');
    throw new Error(`DATA-API.yaml must give the ${account.role} token as ${allowed}`);
  }
  return name;
}

function checkUrl(check: DataApiCheck, publicBaseUrl: string): URL {
  const path = check.path.replace(/\{([^}]+)\}/g, (template, name: string) => {
    const value = check.params.path[name];
    if (value === undefined) throw new SmokeFailure(`path parameter ${template} has no value`);
    return encodeURIComponent(String(value));
  });
  const url = new URL(`${withoutTrailingSlash(publicBaseUrl)}${path}`);
  for (const [name, value] of Object.entries(check.params.query)) url.searchParams.set(name, String(value));
  return url;
}

function missingFields(value: unknown, segments: readonly string[], at: string): string[] {
  const [segment, ...rest] = segments;
  if (segment === undefined) return [];
  if (segment === EACH_ITEM) {
    if (!Array.isArray(value)) return [`${at}${EACH_ITEM}`];
    const items: unknown[] = value;
    return items.flatMap((item, index) => missingFields(item, rest, `${at}[${index}]`));
  }
  const path = at === '' ? segment : `${at}.${segment}`;
  if (!isRecord(value) || !Object.hasOwn(value, segment)) return [path];
  return missingFields(value[segment], rest, path);
}

function listFields(fields: readonly string[]): string {
  const listed = fields.slice(0, LISTED_FIELDS).join(', ');
  return fields.length > LISTED_FIELDS ? `${listed} and ${fields.length - LISTED_FIELDS} more` : listed;
}

async function callCheck(
  fetchFn: typeof fetch,
  check: DataApiCheck,
  publicBaseUrl: string,
  credentials: Credentials | null,
): Promise<string> {
  requireSecureTransport(publicBaseUrl, 'PUBLIC_BASE_URL');
  const headers: Record<string, string> = { ...check.params.headers };
  if (credentials) headers[credentials.header] = `Bearer ${credentials.token}`;
  if (check.params.body !== null) headers['content-type'] = 'application/json';
  const response = await request(fetchFn, checkUrl(check, publicBaseUrl), {
    method: check.method,
    headers,
    body: check.params.body === null ? undefined : JSON.stringify(check.params.body),
  });
  const expected = check.expect.find(({ status }) => status === response.status);
  if (!expected) {
    await discard(response);
    const statuses = check.expect.map(({ status }) => status).join(' or ');
    throw new SmokeFailure(`status ${response.status}, expected ${statuses}`);
  }
  const type = mediaType(response);
  if (type !== expected.contentType) {
    await discard(response);
    throw new SmokeFailure(
      `status ${response.status} with ${type || 'no content type'}, expected ${expected.contentType}`,
    );
  }
  const answer = `${response.status} ${type}`;
  if (expected.requiredFields.length === 0) {
    await discard(response);
    return answer;
  }
  const body = await readJson(response);
  const missing = expected.requiredFields.flatMap((field) => missingFields(body, splitFieldPath(field), ''));
  if (missing.length > 0) throw new SmokeFailure(`${answer} without ${listFields(missing)}`);
  return `${answer} with ${expected.requiredFields.join(', ')}`;
}

export async function apiChecks({ deps }: SmokeContext): Promise<SmokeCheck[]> {
  const dataApi = parseDataApi((await deps.readFile(dataApiFile())).toString('utf8'));
  const accounts = new Map(dataApi.accounts.map((account) => [account.role, account]));

  return dataApi.checks.map((check) => {
    const name = `api.${check.id}`;
    if (check.role === 'anonymous') {
      return smokeCheck(name, ['PUBLIC_BASE_URL'], (publicBaseUrl) =>
        callCheck(deps.fetch, check, publicBaseUrl, null),
      );
    }
    const account = accounts.get(check.role);
    if (!account) throw new Error(`DATA-API.yaml has no ${check.role} account for ${check.id}`);
    return smokeCheck(name, ['PUBLIC_BASE_URL', tokenVariable(account)], (publicBaseUrl, token) =>
      callCheck(deps.fetch, check, publicBaseUrl, { header: account.auth.header, token }),
    );
  });
}
