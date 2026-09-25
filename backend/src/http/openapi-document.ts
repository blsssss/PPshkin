import { loadConfig } from '../config.ts';
import type { Services } from '../services/index.ts';
import { buildApp } from './app.ts';

export const OPENAPI_FILE = new URL('../../../openapi.yaml', import.meta.url);

function unavailableServices(): Services {
  const method = () => Promise.reject(new Error('Services are not available while rendering the document'));
  const service = new Proxy({}, { get: () => method });
  return new Proxy({} as Services, { get: () => service });
}

export async function renderOpenApiYaml(): Promise<string> {
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgres://unused',
    PUBLIC_BASE_URL: 'http://localhost:3000',
  });
  const app = await buildApp({ config, services: unavailableServices() });
  try {
    await app.ready();
    return app.swagger({ yaml: true });
  } finally {
    await app.close();
  }
}
