import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { session } from '../api/index.ts';
import { setDevicePoint } from '../shared/geo/devicePoint.ts';
import { wipeLocalData } from '../shared/storage.ts';

export function useForgetAccount(): () => void {
  const queryClient = useQueryClient();
  return useCallback(() => {
    wipeLocalData();
    setDevicePoint(null);
    queryClient.clear();
    session.markDeleted();
  }, [queryClient]);
}
