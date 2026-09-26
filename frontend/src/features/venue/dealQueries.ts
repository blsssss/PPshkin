import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '../../api/client.ts';
import { api } from '../../api/index.ts';

const DEALS_KEY = ['venue', 'deals'] as const;
const VENUE_BOOKINGS_KEY = ['venue', 'bookings'] as const;
const BOOKINGS_POLL_MS = 30_000;

export function useVenueDeals(status: 'active' | 'finished') {
  return useQuery({
    queryKey: [...DEALS_KEY, status],
    queryFn: async () =>
      unwrap(await api.GET('/api/v1/venue/deals', { params: { query: { status } } })).items,
    staleTime: 0,
  });
}

export function useCreateDeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { menuItemId: number; priceRub: number; quantity: number; endsAt: string }) =>
      unwrap(await api.POST('/api/v1/venue/deals', { body })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: DEALS_KEY });
    },
  });
}

export function useUpdateDeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: number; patch: { quantityLeft?: number; endsAt?: string } }) =>
      unwrap(await api.PATCH('/api/v1/venue/deals/{id}', { params: { path: { id } }, body: patch })),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: DEALS_KEY });
    },
  });
}

export function useCancelDeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await api.DELETE('/api/v1/venue/deals/{id}', { params: { path: { id } } });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: DEALS_KEY });
    },
  });
}

export function useVenueBookings(status: 'active' | 'history', date: string | null, poll = true) {
  return useQuery({
    queryKey: [...VENUE_BOOKINGS_KEY, status, date],
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/venue/bookings', {
          params: { query: { status, ...(date === null ? {} : { date }) } },
        }),
      ).items,
    staleTime: 0,
    refetchInterval: status === 'active' && poll ? BOOKINGS_POLL_MS : false,
    refetchOnWindowFocus: status === 'active' && poll,
  });
}

export function useRedeem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (code: string) =>
      unwrap(await api.POST('/api/v1/venue/bookings/redeem', { body: { code } })),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: VENUE_BOOKINGS_KEY });
    },
  });
}

export function useVenueAnalytics(period: { from: string; to: string }) {
  return useQuery({
    queryKey: ['venue', 'analytics', period.from, period.to],
    queryFn: async () => unwrap(await api.GET('/api/v1/venue/analytics', { params: { query: period } })),
    placeholderData: keepPreviousData,
  });
}
