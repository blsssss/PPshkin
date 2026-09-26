import { devToken, env } from '../env.ts';
import { initData } from '../max/bridge.ts';
import { createApiModule } from './module.ts';

export const { session, api, useSessionState, useSession } = createApiModule({
  baseUrl: env.apiBaseUrl.length > 0 ? env.apiBaseUrl : window.location.origin,
  initData,
  devToken,
});
