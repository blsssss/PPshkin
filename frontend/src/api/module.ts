import { useSyncExternalStore } from 'react';
import type { UserProfile } from './client.ts';
import type { FetchLike } from './http.ts';
import type { SessionState } from './session.ts';
import { createApiSession } from './setup.ts';

export function createApiModule(options: {
  baseUrl: string;
  initData: () => string | null;
  devToken: () => string | null;
  baseFetch?: FetchLike;
}) {
  const { session, api } = createApiSession(options);

  function useSessionState(): SessionState {
    return useSyncExternalStore(
      (listener) => session.subscribe(listener),
      () => session.getState(),
    );
  }

  function useSession(): {
    status: 'loading' | 'ready' | 'error';
    user: UserProfile | null;
    startParam: string | null;
  } {
    const state = useSessionState();
    if (state.status === 'ready') return { status: 'ready', user: state.user, startParam: state.startParam };
    if (state.status === 'loading') return { status: 'loading', user: null, startParam: null };
    return { status: 'error', user: null, startParam: null };
  }

  return { session, api, useSessionState, useSession };
}
