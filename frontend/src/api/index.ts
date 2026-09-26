import { useSyncExternalStore } from 'react';
import { devToken, env } from '../env.ts';
import { initData } from '../max/bridge.ts';
import type { UserProfile } from './client.ts';
import type { SessionState } from './session.ts';
import { createApiSession } from './setup.ts';

export const { session, api } = createApiSession({
  baseUrl: env.apiBaseUrl.length > 0 ? env.apiBaseUrl : window.location.origin,
  initData,
  devToken,
});

export function useSessionState(): SessionState {
  return useSyncExternalStore(
    (listener) => session.subscribe(listener),
    () => session.getState(),
  );
}

export function useSession(): {
  status: 'loading' | 'ready' | 'error';
  user: UserProfile | null;
  startParam: string | null;
} {
  const state = useSessionState();
  if (state.status === 'ready') return { status: 'ready', user: state.user, startParam: state.startParam };
  if (state.status === 'loading') return { status: 'loading', user: null, startParam: null };
  return { status: 'error', user: null, startParam: null };
}
