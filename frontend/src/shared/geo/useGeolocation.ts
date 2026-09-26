import { useCallback, useEffect, useRef, useState } from 'react';

export const WATCHDOG_MS = 12_000;

type GeolocationStatus = 'idle' | 'requesting' | 'granted' | 'denied' | 'unavailable';

export interface GeoPoint {
  lat: number;
  lon: number;
}

interface GeolocationOptions {
  highAccuracy?: boolean;
}

interface GeolocationState {
  status: GeolocationStatus;
  point: GeoPoint | null;
  request: () => Promise<GeoPoint | null>;
}

function geolocationApi(): Geolocation | null {
  try {
    const geolocation = (navigator as { geolocation?: Geolocation }).geolocation;
    return geolocation !== undefined && typeof geolocation.getCurrentPosition === 'function'
      ? geolocation
      : null;
  } catch {
    return null;
  }
}

export function geolocationSupported(): boolean {
  return geolocationApi() !== null;
}

function locate(
  options: GeolocationOptions = {},
): Promise<{ status: GeolocationStatus; point: GeoPoint | null }> {
  const geolocation = geolocationApi();
  if (geolocation === null) {
    return Promise.resolve({ status: 'unavailable', point: null });
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: { status: GeolocationStatus; point: GeoPoint | null }) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      resolve(result);
    };
    const watchdog = setTimeout(() => {
      finish({ status: 'unavailable', point: null });
    }, WATCHDOG_MS);
    try {
      geolocation.getCurrentPosition(
        (position) => {
          finish({
            status: 'granted',
            point: { lat: position.coords.latitude, lon: position.coords.longitude },
          });
        },
        (error) => {
          finish({ status: error.code === error.PERMISSION_DENIED ? 'denied' : 'unavailable', point: null });
        },
        options.highAccuracy === true
          ? { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 }
          : { enableHighAccuracy: false, timeout: 10_000, maximumAge: 600_000 },
      );
    } catch {
      finish({ status: 'unavailable', point: null });
    }
  });
}

export function useGeolocation(options: GeolocationOptions = {}): GeolocationState {
  const [status, setStatus] = useState<GeolocationStatus>('idle');
  const [point, setPoint] = useState<GeoPoint | null>(null);
  const mounted = useRef(true);
  const highAccuracy = options.highAccuracy === true;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const request = useCallback(async () => {
    setStatus('requesting');
    const result = await locate({ highAccuracy });
    if (mounted.current) {
      setStatus(result.status);
      setPoint(result.point);
    }
    return result.point;
  }, [highAccuracy]);

  return { status, point, request };
}
