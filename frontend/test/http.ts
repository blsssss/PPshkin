import type { UserProfile } from '../src/api/client.ts';

export const BASE_URL = 'http://localhost';

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export function problem(
  status: number,
  code: string,
  extra: { errors?: { path: string; message: string }[]; headers?: Record<string, string> } = {},
): Response {
  const body = {
    type: 'about:blank',
    title: 'Error',
    status,
    code,
    detail: 'Developer details in English',
    ...(extra.errors === undefined ? {} : { errors: extra.errors }),
  };
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/problem+json', ...extra.headers },
  });
}

export const TEST_USER: UserProfile = {
  id: 101,
  firstName: 'Анна',
  username: null,
  timezone: 'Europe/Moscow',
  kcalTarget: 2000,
  goal: null,
  dislikedTags: [],
  location: null,
  locationUpdatedAt: null,
  consents: {
    personalData: { granted: true, version: '2026-09-25', grantedAt: '2026-09-25T10:00:00.000Z' },
    personalizedOffers: { granted: false, version: null, grantedAt: null },
  },
};
