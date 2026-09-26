import { ApiError, isApiError } from './errors.ts';
import type { Session, UserProfile } from './client.ts';

export type SessionState =
  | { status: 'loading' }
  | { status: 'ready'; user: UserProfile; startParam: string | null }
  | { status: 'outside' }
  | { status: 'expired' }
  | { status: 'failed'; error: ApiError };

export interface SessionDeps {
  initData(): string | null;
  devToken(): string | null;
  signIn(initData: string): Promise<Session>;
  loadProfile(): Promise<UserProfile>;
}

export interface SessionStore {
  getState(): SessionState;
  subscribe(listener: () => void): () => void;
  start(): Promise<void>;
  token(): string | null;
  refresh(): Promise<boolean>;
  setUser(user: UserProfile): void;
  pendingStartParam(): string | null;
  markStartHandled(): boolean;
}

function asApiError(error: unknown): ApiError {
  return error instanceof ApiError ? error : new ApiError({ status: 500, code: 'internal_error' });
}

export function createSessionStore(deps: SessionDeps): SessionStore {
  let state: SessionState = { status: 'loading' };
  let token: string | null = null;
  let startParam: string | null = null;
  let startHandled = false;
  let refreshing: Promise<boolean> | null = null;
  const listeners = new Set<() => void>();

  const setState = (next: SessionState) => {
    state = next;
    for (const listener of listeners) listener();
  };

  const fail = (error: unknown) => {
    if (isApiError(error, 'init_data_expired')) setState({ status: 'expired' });
    else setState({ status: 'failed', error: asApiError(error) });
  };

  const start = async () => {
    setState({ status: 'loading' });
    token = null;
    const launchData = deps.initData();
    try {
      if (launchData !== null) {
        const session = await deps.signIn(launchData);
        token = session.token;
        startParam = session.startParam;
        setState({ status: 'ready', user: session.user, startParam });
        return;
      }
      const development = deps.devToken();
      if (development === null) {
        setState({ status: 'outside' });
        return;
      }
      token = development;
      const user = await deps.loadProfile();
      setState({ status: 'ready', user, startParam: null });
    } catch (error) {
      token = null;
      fail(error);
    }
  };

  const refreshOnce = async (): Promise<boolean> => {
    const launchData = deps.initData();
    if (launchData === null) return false;
    try {
      const session = await deps.signIn(launchData);
      token = session.token;
      if (state.status === 'ready') setState({ ...state, user: session.user });
      return true;
    } catch (error) {
      if (isApiError(error, 'init_data_expired')) {
        token = null;
        setState({ status: 'expired' });
      }
      return false;
    }
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start,
    token: () => token,
    refresh() {
      refreshing ??= refreshOnce().finally(() => {
        refreshing = null;
      });
      return refreshing;
    },
    setUser(user) {
      if (state.status === 'ready') setState({ ...state, user });
    },
    pendingStartParam: () => (startHandled ? null : startParam),
    markStartHandled() {
      if (startHandled) return false;
      startHandled = true;
      return true;
    },
  };
}
