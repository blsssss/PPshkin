import createClient, { type Client } from 'openapi-fetch';
import type { components, paths } from './schema.d.ts';
import type { FetchLike } from './http.ts';

export type Schemas = components['schemas'];
export type UserProfile = Schemas['UserProfile'];
export type Session = Schemas['Session'];
export type ApiClient = Client<paths>;

export function createApi(fetchImpl: FetchLike, baseUrl: string): ApiClient {
  return createClient<paths>({ baseUrl, fetch: (request) => fetchImpl(request) });
}

export function unwrap<T>(result: { data?: T; response: Response }): T {
  if (result.data === undefined) throw new Error(`Empty response ${result.response.status}`);
  return result.data;
}
