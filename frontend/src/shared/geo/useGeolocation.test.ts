import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { geolocationSupported, useGeolocation, WATCHDOG_MS } from './useGeolocation.ts';

function install(getCurrentPosition: Geolocation['getCurrentPosition'] | null) {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: getCurrentPosition === null ? undefined : { getCurrentPosition },
  });
}

function positionError(code: number): GeolocationPositionError {
  return {
    code,
    PERMISSION_DENIED: 1,
    POSITION_UNAVAILABLE: 2,
    TIMEOUT: 3,
    message: '',
  };
}

afterEach(() => {
  install(null);
});

describe('useGeolocation', () => {
  it('returns the point on success with coarse options', async () => {
    const getCurrentPosition = vi.fn<Geolocation['getCurrentPosition']>((success) => {
      success({ coords: { latitude: 55.79, longitude: 49.12 } } as GeolocationPosition);
    });
    install(getCurrentPosition);
    const { result } = renderHook(() => useGeolocation());
    expect(result.current.status).toBe('idle');
    let point: unknown;
    await act(async () => {
      point = await result.current.request();
    });
    expect(point).toEqual({ lat: 55.79, lon: 49.12 });
    expect(result.current).toMatchObject({ status: 'granted', point: { lat: 55.79, lon: 49.12 } });
    expect(getCurrentPosition.mock.calls[0]?.[2]).toEqual({
      enableHighAccuracy: false,
      timeout: 10_000,
      maximumAge: 600_000,
    });
  });

  it('asks for high accuracy when requested', async () => {
    const getCurrentPosition = vi.fn<Geolocation['getCurrentPosition']>((success) => {
      success({ coords: { latitude: 1, longitude: 2 } } as GeolocationPosition);
    });
    install(getCurrentPosition);
    const { result } = renderHook(() => useGeolocation({ highAccuracy: true }));
    await act(async () => {
      await result.current.request();
    });
    expect(getCurrentPosition.mock.calls[0]?.[2]).toEqual({
      enableHighAccuracy: true,
      timeout: 10_000,
      maximumAge: 0,
    });
  });

  it.each([
    [1, 'denied'],
    [2, 'unavailable'],
    [3, 'unavailable'],
  ])('maps error code %i to %s', async (code, status) => {
    install((_success, failure) => {
      failure?.(positionError(code));
    });
    const { result } = renderHook(() => useGeolocation());
    let point: unknown = 'unset';
    await act(async () => {
      point = await result.current.request();
    });
    expect(point).toBeNull();
    expect(result.current.status).toBe(status);
  });

  it('gives up when the WebView never answers the permission prompt', async () => {
    vi.useFakeTimers();
    install(() => undefined);
    const { result } = renderHook(() => useGeolocation());
    let pending: Promise<unknown> = Promise.resolve();
    act(() => {
      pending = result.current.request();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WATCHDOG_MS);
    });
    await expect(pending).resolves.toBeNull();
    expect(result.current.status).toBe('unavailable');
    vi.useRealTimers();
  });

  it('reports unavailable without the API or when it throws', async () => {
    install(null);
    expect(geolocationSupported()).toBe(false);
    const { result } = renderHook(() => useGeolocation());
    await act(async () => {
      await result.current.request();
    });
    expect(result.current.status).toBe('unavailable');

    install(() => {
      throw new Error('blocked by the iframe');
    });
    expect(geolocationSupported()).toBe(true);
    const next = renderHook(() => useGeolocation());
    await act(async () => {
      await next.result.current.request();
    });
    expect(next.result.current.status).toBe('unavailable');
  });
});
