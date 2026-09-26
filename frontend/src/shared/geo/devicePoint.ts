import { useSyncExternalStore } from 'react';
import type { GeoPoint } from './useGeolocation.ts';

let current: GeoPoint | null = null;
const listeners = new Set<() => void>();

export function setDevicePoint(point: GeoPoint | null): void {
  current = point;
  for (const listener of listeners) listener();
}

export function useDevicePoint(): GeoPoint | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => current,
  );
}

const EARTH_RADIUS_M = 6_371_000;

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function distanceMeters(from: GeoPoint, to: GeoPoint): number {
  const dLat = radians(to.lat - from.lat);
  const dLon = radians(to.lon - from.lon);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(from.lat)) * Math.cos(radians(to.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}
