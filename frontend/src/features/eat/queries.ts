import { useQuery } from '@tanstack/react-query';
import { unwrap } from '../../api/client.ts';
import { api } from '../../api/index.ts';
import { RECOMMENDATIONS_KEY } from '../../api/keys.ts';
import type { GeoPoint } from '../../shared/geo/useGeolocation.ts';

const RECOMMENDATIONS_LIMIT = 5;
const TEN_MINUTES = 10 * 60_000;

export function recommendationsKey(point: GeoPoint | null) {
  return [...RECOMMENDATIONS_KEY, point?.lat ?? null, point?.lon ?? null] as const;
}

export function useRecommendations(point: GeoPoint | null) {
  return useQuery({
    queryKey: recommendationsKey(point),
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/recommendations', {
          params: { query: { limit: RECOMMENDATIONS_LIMIT, ...point } },
        }),
      ),
    staleTime: TEN_MINUTES,
    gcTime: TEN_MINUTES,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

function nearby(point: GeoPoint | null, radius: number) {
  return point === null ? {} : { lat: point.lat, lon: point.lon, radius };
}

export function useNearbyDeals(point: GeoPoint | null, radius: number) {
  return useQuery({
    queryKey: ['deals', point?.lat ?? null, point?.lon ?? null, point === null ? null : radius],
    queryFn: async () => unwrap(await api.GET('/api/v1/deals', { params: { query: nearby(point, radius) } })),
  });
}

export function useNearbyVenues(point: GeoPoint | null, radius: number) {
  return useQuery({
    queryKey: ['venues', point?.lat ?? null, point?.lon ?? null, point === null ? null : radius],
    queryFn: async () =>
      unwrap(await api.GET('/api/v1/venues', { params: { query: nearby(point, radius) } })),
  });
}

export function useVenueDetails(id: number) {
  return useQuery({
    queryKey: ['venue-details', id],
    queryFn: async () => unwrap(await api.GET('/api/v1/venues/{id}', { params: { path: { id } } })),
  });
}
