import { createApiModule } from '../src/api/module.ts';
import { BASE_URL, json, TEST_USER } from './http.ts';
import { createServer } from './server.ts';
import { TEST_INIT_DATA } from './webapp.ts';

export const server = createServer();

function create(initData: string | null) {
  return createApiModule({
    baseUrl: BASE_URL,
    initData: () => initData,
    devToken: () => null,
    baseFetch: server.fetch,
  });
}

let current = create(TEST_INIT_DATA);

export const apiModule = {
  get session() {
    return current.session;
  },
  get api() {
    return current.api;
  },
  useSessionState: () => current.useSessionState(),
  useSession: () => current.useSession(),
};

export function signInResponse(user: unknown = TEST_USER, startParam: string | null = null) {
  return json({ token: 'token-1', expiresAt: '2026-09-27T00:00:00.000Z', startParam, user });
}

export async function startSession(options: { user?: unknown; startParam?: string | null } = {}) {
  server.reset();
  current = create(TEST_INIT_DATA);
  server.on('POST', '/api/v1/auth/max', () =>
    signInResponse(options.user ?? TEST_USER, options.startParam ?? null),
  );
  await current.session.start();
}
