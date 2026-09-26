import { describe, expect, it, vi } from 'vitest';
import { json } from '../../test/http.ts';
import { createApiFetch, type AuthBinding } from './http.ts';

function auth(): AuthBinding {
  return { token: () => 'token-1', refresh: () => Promise.resolve(false) };
}

describe('automatic retry', () => {
  it('repeats a GET once after a second on a gateway error and never repeats writes', async () => {
    vi.useFakeTimers();
    const statuses = [503, 200];
    const calls: string[] = [];
    const apiFetch = createApiFetch(auth(), (request) => {
      calls.push(request.method);
      return Promise.resolve(json({ ok: true }, statuses.shift() ?? 200));
    });
    const pending = apiFetch(new Request('http://localhost/api/v1/me'));
    await vi.advanceTimersByTimeAsync(999);
    expect(calls).toEqual(['GET']);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toHaveProperty('status', 200);
    expect(calls).toEqual(['GET', 'GET']);

    const failing = createApiFetch(auth(), (request) => {
      calls.push(request.method);
      return Promise.resolve(json({ code: 'unavailable' }, 503));
    });
    await expect(
      failing(new Request('http://localhost/api/v1/me', { method: 'PATCH', body: '{}' })),
    ).rejects.toThrow();
    expect(calls.filter((method) => method === 'PATCH')).toHaveLength(1);
    vi.useRealTimers();
  });

  it('repeats a GET once after a network error and then gives up', async () => {
    vi.useFakeTimers();
    let count = 0;
    const apiFetch = createApiFetch(auth(), () => {
      count += 1;
      return Promise.reject(new TypeError('Failed to fetch'));
    });
    const pending = apiFetch(new Request('http://localhost/api/v1/me'));
    const settled = expect(pending).rejects.toMatchObject({ code: 'network_error' });
    await vi.advanceTimersByTimeAsync(1000);
    await settled;
    expect(count).toBe(2);
    vi.useRealTimers();
  });
});
