import { readFile } from 'node:fs/promises';
import { vi } from 'vitest';
import type { Recognition } from '../src/ports/recognition.ts';
import type { SmokeDependencies } from '../src/smoke/check.ts';
import { fixedClock, type ControlledClock } from './clock.ts';
import { fakeMaxApi } from './max-api.ts';

interface FakeSmokeDependencies extends SmokeDependencies {
  clock: ControlledClock;
}

function notStubbed(name: string) {
  return () => Promise.reject(new Error(`${name} is not stubbed`));
}

export function fakeRecognition(
  overrides: { dishes?: Partial<Recognition['dishes']>; menus?: Partial<Recognition['menus']> } = {},
): Recognition {
  return {
    dishes: {
      fromPhoto: vi.fn(notStubbed('dishes.fromPhoto')),
      fromText: vi.fn(notStubbed('dishes.fromText')),
      ...overrides.dishes,
    },
    menus: {
      fromPhoto: vi.fn(notStubbed('menus.fromPhoto')),
      fromText: vi.fn(notStubbed('menus.fromText')),
      ...overrides.menus,
    },
  };
}

export function fakeSmokeDependencies(
  overrides: Partial<Omit<SmokeDependencies, 'clock'>> = {},
): FakeSmokeDependencies {
  return {
    fetch: vi.fn<typeof fetch>(notStubbed('fetch')),
    createMaxApi: vi.fn(() => fakeMaxApi()),
    createRecognition: vi.fn(() => fakeRecognition()),
    readFile: vi.fn((file: URL) => readFile(file)),
    ...overrides,
    clock: fixedClock('2026-09-27T09:00:00.000Z'),
  };
}

export function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

export function routedFetch(routes: Record<string, () => Response>) {
  return vi.fn<typeof fetch>((input) => {
    const url = requestUrl(input);
    const route = routes[url];
    return route ? Promise.resolve(route()) : Promise.reject(new Error(`unexpected request to ${url}`));
  });
}

export const jsonResponse = (body: unknown, status = 200, contentType = 'application/json') =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': contentType } });
