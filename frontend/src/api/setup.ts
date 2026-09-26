import { createApi, unwrap, type ApiClient } from './client.ts';
import { createApiFetch, type FetchLike } from './http.ts';
import { createSessionStore, type SessionStore } from './session.ts';

export function createApiSession(options: {
  baseUrl: string;
  initData: () => string | null;
  devToken: () => string | null;
  baseFetch?: FetchLike;
}): { session: SessionStore; api: ApiClient } {
  const publicApi = createApi(
    createApiFetch({ token: () => null, refresh: () => Promise.resolve(false) }, options.baseFetch),
    options.baseUrl,
  );
  const session: SessionStore = createSessionStore({
    initData: options.initData,
    devToken: options.devToken,
    signIn: async (initData) => unwrap(await publicApi.POST('/api/v1/auth/max', { body: { initData } })),
    loadProfile: async () => unwrap(await api.GET('/api/v1/me')),
  });
  const api: ApiClient = createApi(
    createApiFetch({ token: () => session.token(), refresh: () => session.refresh() }, options.baseFetch),
    options.baseUrl,
  );
  return { session, api };
}
