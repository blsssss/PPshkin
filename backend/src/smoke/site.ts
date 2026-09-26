import { parse } from 'yaml';
import { z } from 'zod';
import { smokeCheck, SmokeFailure, type SmokeCheck, type SmokeContext } from './check.ts';
import { findRepoFile } from './data-api.ts';
import { discard, mediaType, readJson, request, requireVerifiedTls, withoutTrailingSlash } from './http.ts';

const BRIDGE_SCRIPT = 'https://st.max.ru/js/max-web-app.js';
const PROBES = ['/health', '/ready'];
const OPENAPI_FILE_NAME = 'openapi.yaml';

const openApiDocument = z.object({
  openapi: z.string().regex(/^3\./),
  info: z.object({ version: z.string().min(1) }),
});

export function siteChecks({ env, deps }: SmokeContext): SmokeCheck[] {
  const siteBase = (publicBaseUrl: string) => {
    requireVerifiedTls(publicBaseUrl, 'PUBLIC_BASE_URL', env);
    return withoutTrailingSlash(publicBaseUrl);
  };

  return [
    smokeCheck('site.health', ['PUBLIC_BASE_URL'], async (publicBaseUrl) => {
      const base = siteBase(publicBaseUrl);
      const answers: { path: string; status: number }[] = [];
      for (const path of PROBES) {
        const response = await request(deps.fetch, `${base}${path}`);
        await discard(response);
        answers.push({ path, status: response.status });
      }
      const summary = answers.map(({ path, status }) => `${path} ${status}`).join(', ');
      if (answers.some(({ status }) => status !== 200)) throw new SmokeFailure(`${summary}, expected 200`);
      return summary;
    }),

    smokeCheck('site.miniapp', ['PUBLIC_BASE_URL'], async (publicBaseUrl) => {
      const response = await request(deps.fetch, `${siteBase(publicBaseUrl)}/`);
      const type = mediaType(response);
      if (response.status !== 200 || type !== 'text/html') {
        await discard(response);
        throw new SmokeFailure(
          `status ${response.status} with ${type || 'no content type'}, expected 200 text/html`,
        );
      }
      if (!(await response.text()).includes(BRIDGE_SCRIPT)) {
        throw new SmokeFailure(`the page does not load ${BRIDGE_SCRIPT}`);
      }
      return `200 text/html, loads ${BRIDGE_SCRIPT}`;
    }),

    smokeCheck('site.docs', ['PUBLIC_BASE_URL'], async (publicBaseUrl) => {
      const base = siteBase(publicBaseUrl);
      const committed = openApiDocument.parse(
        parse((await deps.readFile(findRepoFile(OPENAPI_FILE_NAME))).toString('utf8')),
      );
      const response = await request(deps.fetch, `${base}/docs/json`);
      if (response.status !== 200) {
        await discard(response);
        throw new SmokeFailure(`status ${response.status}, expected 200`);
      }
      const served = openApiDocument.safeParse(await readJson(response));
      if (!served.success) throw new SmokeFailure('the answer is not an OpenAPI 3 document');
      const { version } = served.data.info;
      if (version !== committed.info.version) {
        throw new SmokeFailure(
          `info.version is ${version}, ${OPENAPI_FILE_NAME} has ${committed.info.version}`,
        );
      }
      return `OpenAPI ${served.data.openapi}, info.version ${version}`;
    }),
  ];
}
