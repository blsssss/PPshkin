import type { ApiError } from './errors.ts';

type Listener = (error: ApiError) => void;

const listeners = new Set<Listener>();

export function onApiError(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitApiError(error: ApiError): ApiError {
  for (const listener of listeners) listener(error);
  return error;
}
