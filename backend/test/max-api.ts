import { vi } from 'vitest';
import type { MaxApi } from '../src/integrations/max/api.ts';

function notStubbed(name: string) {
  return () => Promise.reject(new Error(`${name} is not stubbed`));
}

export function fakeMaxApi(overrides: Partial<MaxApi> = {}): MaxApi {
  return {
    getMe: vi.fn(notStubbed('getMe')),
    getUpdates: vi.fn(notStubbed('getUpdates')),
    sendMessage: vi.fn(notStubbed('sendMessage')),
    editMessage: vi.fn(notStubbed('editMessage')),
    answerCallback: vi.fn(notStubbed('answerCallback')),
    sendAction: vi.fn(notStubbed('sendAction')),
    uploadImage: vi.fn(notStubbed('uploadImage')),
    listSubscriptions: vi.fn(notStubbed('listSubscriptions')),
    subscribe: vi.fn(notStubbed('subscribe')),
    unsubscribe: vi.fn(notStubbed('unsubscribe')),
    setCommands: vi.fn(notStubbed('setCommands')),
    download: vi.fn(notStubbed('download')),
    ...overrides,
  };
}

export function waitForAbort(signal: AbortSignal | undefined): Promise<never> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => {
      reject(signal.reason as Error);
    });
  });
}

export const fakeLogger = () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() });
