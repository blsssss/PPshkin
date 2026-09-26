import type { GeoPoint } from '../domain/models.ts';
import type { ErrorDetail } from './errors.ts';

const EARTH_RADIUS_M = 6_371_000;

const radians = (degrees: number) => (degrees * Math.PI) / 180;

export function distanceMeters(from: GeoPoint, to: GeoPoint): number {
  const dLat = radians(to.lat - from.lat);
  const dLon = radians(to.lon - from.lon);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(from.lat)) * Math.cos(radians(to.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function roundCoordinate(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function coarsePoint(point: GeoPoint): GeoPoint {
  return { lat: roundCoordinate(point.lat), lon: roundCoordinate(point.lon) };
}

export function pointProblems({ lat, lon }: GeoPoint): ErrorDetail[] {
  const problems: ErrorDetail[] = [];
  if (!(lat >= -90 && lat <= 90)) problems.push({ path: 'lat', message: 'must be from -90 to 90' });
  if (!(lon >= -180 && lon <= 180)) problems.push({ path: 'lon', message: 'must be from -180 to 180' });
  return problems;
}
