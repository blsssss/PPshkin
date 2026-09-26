import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { unwrap } from '../../api/client.ts';
import { isApiError } from '../../api/errors.ts';
import { onApiError } from '../../api/events.ts';
import { api } from '../../api/index.ts';
import type { MenuImport, MenuItem, MenuItemInput, Venue, VenueInput } from './model.ts';

const VENUE_KEY = ['venue'] as const;
export const MENU_KEY = ['venue', 'menu'] as const;

export function importKey(id: number) {
  return ['venue', 'import', id] as const;
}

export function useVenue() {
  return useQuery({
    queryKey: VENUE_KEY,
    queryFn: async (): Promise<Venue | null> => {
      try {
        return unwrap(await api.GET('/api/v1/venue'));
      } catch (error) {
        if (isApiError(error, 'venue_not_found')) return null;
        throw error;
      }
    },
  });
}

export function useReloadVenue(): () => Promise<void> {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: VENUE_KEY, exact: true }),
      queryClient.invalidateQueries({ queryKey: MENU_KEY }),
    ]);
  };
}

export function useVenueMenu(enabled = true) {
  return useQuery({
    queryKey: MENU_KEY,
    queryFn: async (): Promise<MenuItem[]> => unwrap(await api.GET('/api/v1/venue/menu')).items,
    enabled,
  });
}

export function useSaveVenue() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (request: { create: VenueInput } | { patch: Partial<VenueInput> }) =>
      'create' in request
        ? unwrap(await api.POST('/api/v1/venue', { body: request.create }))
        : unwrap(await api.PATCH('/api/v1/venue', { body: request.patch })),
    onSuccess: (venue) => {
      queryClient.setQueryData(VENUE_KEY, venue);
    },
  });
}

function replaceItem(items: MenuItem[] | undefined, item: MenuItem): MenuItem[] | undefined {
  if (items === undefined) return items;
  return items.some((entry) => entry.id === item.id)
    ? items.map((entry) => (entry.id === item.id ? item : entry))
    : [...items, item];
}

export function useSaveItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (request: { create: MenuItemInput } | { id: number; patch: Partial<MenuItemInput> }) =>
      'create' in request
        ? unwrap(await api.POST('/api/v1/venue/menu/items', { body: request.create }))
        : unwrap(
            await api.PATCH('/api/v1/venue/menu/items/{id}', {
              params: { path: { id: request.id } },
              body: request.patch,
            }),
          ),
    onSuccess: (item) => {
      queryClient.setQueryData<MenuItem[]>(MENU_KEY, (items) => replaceItem(items, item));
    },
  });
}

export function useToggleAvailability() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, isAvailable }: { id: number; isAvailable: boolean }) =>
      unwrap(
        await api.PATCH('/api/v1/venue/menu/items/{id}', {
          params: { path: { id } },
          body: { isAvailable },
        }),
      ),
    onMutate: async ({ id, isAvailable }) => {
      await queryClient.cancelQueries({ queryKey: MENU_KEY });
      const previous = queryClient.getQueryData<MenuItem[]>(MENU_KEY)?.find((item) => item.id === id);
      queryClient.setQueryData<MenuItem[]>(MENU_KEY, (items) =>
        items?.map((item) => (item.id === id ? { ...item, isAvailable } : item)),
      );
      return { previous };
    },
    onError: (_error, { id }, context) => {
      const previous = context?.previous;
      if (previous === undefined) return;
      queryClient.setQueryData<MenuItem[]>(MENU_KEY, (items) =>
        items?.map((item) => (item.id === id ? { ...item, isAvailable: previous.isAvailable } : item)),
      );
    },
    onSuccess: (item) => {
      queryClient.setQueryData<MenuItem[]>(MENU_KEY, (items) => replaceItem(items, item));
    },
  });
}

export function useDeleteItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await api.DELETE('/api/v1/venue/menu/items/{id}', { params: { path: { id } } });
      return id;
    },
    onSuccess: (id) => {
      queryClient.setQueryData<MenuItem[]>(MENU_KEY, (items) => items?.filter((item) => item.id !== id));
    },
  });
}

export async function startTextImport(text: string): Promise<MenuImport> {
  return unwrap(await api.POST('/api/v1/venue/menu/imports/text', { body: { text } }));
}

export async function startPhotoImport(file: File): Promise<MenuImport> {
  return unwrap(
    await api.POST('/api/v1/venue/menu/imports/photo', {
      body: { image: '' },
      bodySerializer: () => {
        const form = new FormData();
        form.append('image', file);
        return form;
      },
    }),
  );
}

export async function fetchImport(id: number): Promise<MenuImport> {
  return unwrap(await api.GET('/api/v1/venue/menu/imports/{id}', { params: { path: { id } } }));
}

export function useVenueNotFoundRedirect(): void {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  useEffect(
    () =>
      onApiError((error) => {
        if (!isApiError(error, 'venue_not_found')) return;
        queryClient.setQueryData(VENUE_KEY, null);
        queryClient.removeQueries({ queryKey: MENU_KEY });
        void navigate('/venue', { replace: true });
      }),
    [queryClient, navigate],
  );
}
