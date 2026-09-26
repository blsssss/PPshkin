import { env } from '../env.ts';

export const HOME_PATH = '/diary';

const PAYLOAD_PATTERN = /^[A-Za-z0-9_-]{1,512}$/;
const ID_PATTERN = /^[1-9][0-9]{0,17}$/;

export const START_ROUTES: readonly { prefix: string; path: (id: string) => string }[] = [
  { prefix: 'venue_', path: (id) => `/venues/${id}` },
  { prefix: 'deal_', path: (id) => `/deals?highlight=${id}` },
  { prefix: 'booking_', path: (id) => `/bookings/${id}` },
  { prefix: 'import_', path: (id) => `/venue/menu/import/${id}` },
];

export interface StartTarget {
  path: string;
  recognized: boolean;
}

export function resolveStartParam(value: string | null): StartTarget {
  if (value === null || value.length === 0) return { path: HOME_PATH, recognized: true };
  for (const route of START_ROUTES) {
    if (!value.startsWith(route.prefix)) continue;
    const id = value.slice(route.prefix.length);
    if (ID_PATTERN.test(id)) return { path: route.path(id), recognized: true };
  }
  return { path: HOME_PATH, recognized: false };
}

export function parseStartParam(value: string | null): string {
  return resolveStartParam(value).path;
}

function isValidStartPayload(payload: string): boolean {
  return PAYLOAD_PATTERN.test(payload);
}

export function buildStartAppLink(payload: string, botName: string = env.botName): string {
  if (!isValidStartPayload(payload))
    throw new Error('startapp payload must be 1-512 chars of A-Z a-z 0-9 _ -');
  return `https://max.ru/${botName}?startapp=${payload}`;
}

export function botLink(botName: string = env.botName): string {
  return `https://max.ru/${botName}`;
}
