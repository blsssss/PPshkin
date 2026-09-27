import { useEffect, useRef, useState } from 'react';
import { isApiError } from '../../api/errors.ts';
import { userMessage } from '../../api/messages.ts';
import { haptic } from '../../max/bridge.ts';
import { ImageDecodeError, prepareImage } from '../../shared/image.ts';
import { useToast } from '../../shared/ui/Toast.tsx';
import { isLostResponse, logPhoto, logText, type LogSource } from './logging.ts';
import { fetchDay, useCachedToday, useRefreshDiary, type DiaryDay, type MealLogResult } from './queries.ts';

const SLOW_AFTER_MS = 10_000;
const PHOTO_MAX_SIDE = 1600;
const LOST_RESPONSE = 'Не дождались ответа. Проверили дневник: если запись сохранилась, она уже в списке';

export type LoggerState =
  | { kind: 'idle' }
  | { kind: 'working'; source: LogSource; preview: string | null; slow: boolean }
  | { kind: 'result'; source: LogSource; result: MealLogResult }
  | { kind: 'error'; source: LogSource; message: string; retryable: boolean };

interface UnconfirmedAttempt {
  source: LogSource;
  knownMealIds: ReadonlySet<number> | null;
}

function savedSince(day: DiaryDay, { source, knownMealIds }: UnconfirmedAttempt): boolean {
  return (
    knownMealIds === null || day.meals.some((meal) => meal.source === source && !knownMealIds.has(meal.id))
  );
}

function errorMessage(error: unknown, source: LogSource): string {
  if (error instanceof ImageDecodeError) return 'Нужен файл JPEG, PNG или WebP';
  if (isApiError(error) && error.status === 429) {
    const wait = error.retryAfterSeconds;
    const prefix = source === 'photo' ? 'Слишком много фото подряд' : 'Слишком много запросов подряд';
    return wait !== null && wait > 0
      ? `${prefix}, попробуйте через ${wait} с`
      : `${prefix}, попробуйте позже`;
  }
  return userMessage(error);
}

export function useMealLogger() {
  const [state, setState] = useState<LoggerState>({ kind: 'idle' });
  const [description, setDescription] = useState('');
  const refresh = useRefreshDiary();
  const cachedToday = useCachedToday();
  const toast = useToast();
  const previewRef = useRef<string | null>(null);
  const lastAttempt = useRef<(() => Promise<void>) | null>(null);
  const unconfirmed = useRef<UnconfirmedAttempt | null>(null);
  const run = useRef(0);

  const releasePreview = () => {
    if (previewRef.current !== null) {
      URL.revokeObjectURL(previewRef.current);
      previewRef.current = null;
    }
  };

  useEffect(() => releasePreview, []);

  useEffect(() => {
    if (state.kind !== 'working' || state.slow) return;
    const timer = setTimeout(() => {
      setState((current) => (current.kind === 'working' ? { ...current, slow: true } : current));
    }, SLOW_AFTER_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [state]);

  const checkDiary = async (): Promise<DiaryDay> => {
    const day = await fetchDay(null);
    void refresh(day);
    return day;
  };

  const execute = async (source: LogSource, task: () => Promise<MealLogResult>, preview: string | null) => {
    run.current += 1;
    const id = run.current;
    const known = cachedToday();
    const knownMealIds = known === undefined ? null : new Set(known.meals.map((meal) => meal.id));
    unconfirmed.current = null;
    setState({ kind: 'working', source, preview, slow: false });
    try {
      const result = await task();
      if (result.status === 'logged') {
        haptic.success();
        if (source === 'text') setDescription('');
        void refresh(result.day);
        if (id !== run.current)
          toast.show(
            source === 'photo'
              ? 'Фото распознано и записано в дневник'
              : 'Описание распознано и записано в дневник',
          );
      }
      if (id === run.current) setState({ kind: 'result', source, result });
    } catch (error) {
      haptic.error();
      const lost = isLostResponse(error);
      const checked =
        lost &&
        (await checkDiary().then(
          () => true,
          () => false,
        ));
      if (id !== run.current) return;
      unconfirmed.current = lost && !checked ? { source, knownMealIds } : null;
      setState({
        kind: 'error',
        source,
        message: checked ? LOST_RESPONSE : errorMessage(error, source),
        retryable: !checked,
      });
    }
  };

  const confirmThenRetry = async (attempt: UnconfirmedAttempt) => {
    run.current += 1;
    const id = run.current;
    setState({ kind: 'working', source: attempt.source, preview: previewRef.current, slow: false });
    let day: DiaryDay;
    try {
      day = await checkDiary();
    } catch (error) {
      haptic.error();
      if (id === run.current) {
        setState({
          kind: 'error',
          source: attempt.source,
          message: errorMessage(error, attempt.source),
          retryable: true,
        });
      }
      return;
    }
    if (id !== run.current) return;
    unconfirmed.current = null;
    if (savedSince(day, attempt)) {
      setState({ kind: 'error', source: attempt.source, message: LOST_RESPONSE, retryable: false });
      return;
    }
    await lastAttempt.current?.();
  };

  const logFile = async (file: File) => {
    lastAttempt.current = () => logFile(file);
    releasePreview();
    const preview = URL.createObjectURL(file);
    previewRef.current = preview;
    await execute('photo', async () => logPhoto(await prepareImage(file, PHOTO_MAX_SIDE)), preview);
  };

  const logDescription = async (text: string) => {
    lastAttempt.current = () => logDescription(text);
    await execute('text', () => logText(text), null);
  };

  return {
    state,
    description,
    setDescription,
    logFile,
    logText: logDescription,
    retry: async () => {
      if (unconfirmed.current === null) await lastAttempt.current?.();
      else await confirmThenRetry(unconfirmed.current);
    },
    reset: () => {
      run.current += 1;
      releasePreview();
      setState({ kind: 'idle' });
    },
  };
}
