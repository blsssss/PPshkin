import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { unwrap } from '../../api/client.ts';
import { api } from '../../api/index.ts';
import type { Booking } from './model.ts';

const BOOKINGS_KEY = ['bookings'] as const;
const POLL_MS = 15_000;

function bookingKey(id: number) {
  return [...BOOKINGS_KEY, 'one', id] as const;
}

function listKey(status: 'active' | 'history') {
  return [...BOOKINGS_KEY, 'list', status] as const;
}

const LIST_POLL_MS = 60_000;

export function useBookings(status: 'active' | 'history') {
  const query = useQuery({
    queryKey: listKey(status),
    queryFn: async () => unwrap(await api.GET('/api/v1/bookings', { params: { query: { status } } })).items,
    refetchInterval: (current) => {
      const items = current.state.data;
      if (status !== 'active' || items === undefined || items.length === 0) return false;
      const earliest = Math.min(...items.map((item) => new Date(item.expiresAt).getTime()));
      return Math.min(LIST_POLL_MS, Math.max(1000, earliest - Date.now() + 2000));
    },
  });
  const { refetch } = query;

  useEffect(() => {
    if (status !== 'active') return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refetch();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [status, refetch]);

  return query;
}

export function useBooking(id: number) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: bookingKey(id),
    enabled: Number.isSafeInteger(id) && id > 0,
    queryFn: async () => unwrap(await api.GET('/api/v1/bookings/{id}', { params: { path: { id } } })),
    refetchInterval: (current) => (current.state.data?.status === 'active' ? POLL_MS : false),
    retry: false,
  });
  const status = query.data?.status;
  const { refetch } = query;

  useEffect(() => {
    if (status !== 'active') return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refetch();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [status, refetch]);

  useEffect(() => {
    if (status !== undefined && status !== 'active') {
      void queryClient.invalidateQueries({ queryKey: [...BOOKINGS_KEY, 'list'] });
    }
  }, [status, queryClient]);

  return query;
}

export function useBookingQr(id: number, enabled: boolean) {
  const query = useQuery({
    queryKey: [...BOOKINGS_KEY, 'qr', id],
    queryFn: async () => {
      const result = await api.GET('/api/v1/bookings/{id}/qr', {
        params: { path: { id } },
        parseAs: 'blob',
      });
      return unwrap(result);
    },
    enabled,
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
  });
  const [url, setUrl] = useState<string | null>(null);
  const blob = query.data;

  useEffect(() => {
    if (blob === undefined) return;
    const created = URL.createObjectURL(blob);
    let active = true;
    void Promise.resolve().then(() => {
      if (active) setUrl(created);
    });
    return () => {
      active = false;
      URL.revokeObjectURL(created);
    };
  }, [blob]);

  return { url: blob === undefined ? null : url, query };
}

export function useCreateBooking() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { menuItemId: number; dealId?: number; offerId?: number }) =>
      unwrap(await api.POST('/api/v1/bookings', { body })),
    onSuccess: (booking: Booking) => {
      queryClient.setQueryData(bookingKey(booking.id), booking);
      void queryClient.invalidateQueries({ queryKey: [...BOOKINGS_KEY, 'list'] });
    },
  });
}

export function useCancelBooking(id: number) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      unwrap(await api.POST('/api/v1/bookings/{id}/cancel', { params: { path: { id } } })),
    onSuccess: (booking) => {
      queryClient.setQueryData(bookingKey(id), booking);
      void queryClient.invalidateQueries({ queryKey: [...BOOKINGS_KEY, 'list'] });
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: bookingKey(id) });
    },
  });
}
