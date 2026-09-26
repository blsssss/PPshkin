import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { unwrap, type Schemas } from '../../api/client.ts';
import { api } from '../../api/index.ts';
import { RECOMMENDATIONS_KEY } from '../../api/keys.ts';

export type DiaryDay = Schemas['DiaryDay'];
export type Meal = Schemas['Meal'];
export type MealLogResult = Schemas['MealLogResult'];
export type MealCandidate = Schemas['MealCandidate'];

const DIARY_KEY = ['diary'] as const;
const TODAY_KEY = ['diary', 'today'] as const;
const INSIGHTS_KEY = ['insights'] as const;

function dayKey(date: string) {
  return ['diary', 'day', date] as const;
}

function summaryKey(days: number) {
  return ['diary', 'summary', days] as const;
}

export function useToday() {
  return useQuery({
    queryKey: TODAY_KEY,
    queryFn: async () => unwrap(await api.GET('/api/v1/diary/today')),
  });
}

export function useDiaryDay(date: string | null) {
  const client = useQueryClient();
  return useQuery({
    queryKey: date === null ? TODAY_KEY : dayKey(date),
    queryFn: async () => {
      const day =
        date === null
          ? unwrap(await api.GET('/api/v1/diary/today'))
          : unwrap(await api.GET('/api/v1/diary/days/{date}', { params: { path: { date } } }));
      client.setQueryData(dayKey(day.date), day);
      return day;
    },
  });
}

export function useSummary(days: number) {
  return useQuery({
    queryKey: summaryKey(days),
    queryFn: async () => unwrap(await api.GET('/api/v1/diary/summary', { params: { query: { days } } })).days,
  });
}

export function useInsights() {
  return useQuery({
    queryKey: INSIGHTS_KEY,
    queryFn: async () => unwrap(await api.GET('/api/v1/insights')),
  });
}

async function refreshDiary(client: QueryClient, day?: DiaryDay): Promise<void> {
  if (day !== undefined) {
    client.setQueryData(dayKey(day.date), day);
    const today = client.getQueryData<DiaryDay>(TODAY_KEY);
    if (today?.date === day.date) client.setQueryData(TODAY_KEY, day);
  }
  client.removeQueries({ queryKey: RECOMMENDATIONS_KEY });
  await Promise.all([
    client.invalidateQueries({ queryKey: day === undefined ? DIARY_KEY : ['diary', 'summary'] }),
    client.invalidateQueries({ queryKey: INSIGHTS_KEY }),
  ]);
}

export function useRefreshDiary(): (day?: DiaryDay) => Promise<void> {
  const client = useQueryClient();
  return useCallback((day?: DiaryDay) => refreshDiary(client, day), [client]);
}
