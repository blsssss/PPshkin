import { createHmac } from 'node:crypto';

export function signInitData(fields: Record<string, string>, botToken: string): string {
  const checkString = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key] ?? ''}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secret).update(checkString).digest('hex');
  const encoded = Object.entries(fields).map(([key, value]) => `${key}=${encodeURIComponent(value)}`);
  return [...encoded, `hash=${hash}`].join('&');
}

export function maxUserJson(id: number, firstName = 'Анна', extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id,
    first_name: firstName,
    last_name: '',
    username: null,
    language_code: 'ru',
    ...extra,
  });
}
