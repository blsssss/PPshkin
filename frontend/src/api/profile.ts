import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { unwrap, type Schemas, type UserProfile } from './client.ts';
import { api, session, useSessionState } from './index.ts';

export const PROFILE_KEY = ['me'] as const;
export const CONSENTS_KEY = ['consents'] as const;

type ProfilePatch = Schemas['ProfilePatchInput'];
type ConsentKind = Schemas['ConsentDocument']['kind'];

export function useProfile() {
  const state = useSessionState();
  const initial = state.status === 'ready' ? state.user : undefined;
  return useQuery({
    queryKey: PROFILE_KEY,
    queryFn: async () => {
      const user = unwrap(await api.GET('/api/v1/me'));
      session.setUser(user);
      return user;
    },
    initialData: initial,
    staleTime: 60_000,
  });
}

function useStoreProfile(): (user: UserProfile) => void {
  const queryClient = useQueryClient();
  return useCallback(
    (user: UserProfile) => {
      queryClient.setQueryData(PROFILE_KEY, user);
      session.setUser(user);
    },
    [queryClient],
  );
}

export function useUpdateProfile() {
  const store = useStoreProfile();
  return useMutation({
    mutationFn: async (patch: ProfilePatch) => unwrap(await api.PATCH('/api/v1/me', { body: patch })),
    onSuccess: store,
  });
}

export function useConsents() {
  return useQuery({
    queryKey: CONSENTS_KEY,
    queryFn: async () => unwrap(await api.GET('/api/v1/consents')).items,
    staleTime: 5 * 60_000,
  });
}

export function useGrantConsent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ kind, version }: { kind: ConsentKind; version: string }) =>
      unwrap(await api.PUT('/api/v1/consents/{kind}', { params: { path: { kind } }, body: { version } })),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: CONSENTS_KEY }),
        queryClient.refetchQueries({ queryKey: PROFILE_KEY }),
      ]);
    },
  });
}

export function useRevokeConsent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (kind: ConsentKind) => {
      await api.DELETE('/api/v1/consents/{kind}', { params: { path: { kind } } });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: CONSENTS_KEY }),
        queryClient.refetchQueries({ queryKey: PROFILE_KEY }),
      ]);
    },
  });
}

export function useSaveLocation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (point: { lat: number; lon: number } | null) => {
      if (point === null) await api.DELETE('/api/v1/me/location');
      else await api.PUT('/api/v1/me/location', { body: point });
    },
    onSuccess: async () => {
      await queryClient.refetchQueries({ queryKey: PROFILE_KEY });
    },
  });
}
