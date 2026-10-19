import { useMutation } from '@tanstack/react-query';
import { unwrap } from '../../api/client.ts';
import { api } from '../../api/index.ts';
import type { ComplaintReason } from './model.ts';

export function useCreateComplaint() {
  return useMutation({
    mutationFn: async (body: {
      venueId: number;
      bookingId?: number;
      reason: ComplaintReason;
      text?: string;
    }) => unwrap(await api.POST('/api/v1/complaints', { body })),
  });
}
