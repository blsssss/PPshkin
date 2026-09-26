import type { GeoPoint } from '../domain/models.ts';
import { distanceMeters } from '../shared/geo.ts';

export const DEMO_CITY_CENTER: GeoPoint = { lat: 55.7887, lon: 49.1221 };
export const DEMO_FAR_DISTANCE_M = 50_000;

export interface DemoPoint {
  point: GeoPoint | null;
  demoCenterUsed: boolean;
}

export function resolveDemoPoint(point: GeoPoint | null, demoMode: boolean): DemoPoint {
  if (!demoMode || point === null || distanceMeters(point, DEMO_CITY_CENTER) <= DEMO_FAR_DISTANCE_M) {
    return { point, demoCenterUsed: false };
  }
  return { point: DEMO_CITY_CENTER, demoCenterUsed: true };
}
