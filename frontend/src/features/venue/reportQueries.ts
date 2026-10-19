import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { keepPreviousData } from '@tanstack/react-query';
import { unwrap } from '../../api/client.ts';
import { api } from '../../api/index.ts';

const REPORT_KEY = ['venue', 'report'] as const;

export function useVenueReport(range: { from: string; to: string }) {
  return useQuery({
    queryKey: [...REPORT_KEY, range.from, range.to],
    queryFn: async () => unwrap(await api.GET('/api/v1/venue/reports', { params: { query: range } })),
    placeholderData: keepPreviousData,
  });
}

export function useCloseOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ dealId, writtenOff }: { dealId: number; writtenOff: number }) =>
      unwrap(
        await api.PUT('/api/v1/venue/deals/{id}/closeout', {
          params: { path: { id: dealId } },
          body: { writtenOff },
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: REPORT_KEY });
    },
  });
}

export function useExportReport() {
  return useMutation({
    mutationFn: async (body: { from: string; to: string; format: 'csv' | 'pdf' }) =>
      unwrap(await api.POST('/api/v1/venue/reports/export', { body })),
  });
}
