import { useEffect, useRef, useState } from 'react';
import { isApiError, NETWORK_ERROR, TIMEOUT_ERROR } from '../../api/errors.ts';
import { userMessage } from '../../api/messages.ts';
import { haptic } from '../../max/bridge.ts';
import { ImageDecodeError, prepareImage } from '../../shared/image.ts';
import { useToast } from '../../shared/ui/Toast.tsx';
import { logPhoto, logText } from './logging.ts';
import { useRefreshDiary, type MealLogResult } from './queries.ts';

const SLOW_AFTER_MS = 15_000;
const PHOTO_MAX_SIDE = 1600;

export type LoggerState =
  | { kind: 'idle' }
  | { kind: 'working'; source: 'photo' | 'text'; preview: string | null; slow: boolean }
  | { kind: 'result'; source: 'photo' | 'text'; result: MealLogResult }
  | { kind: 'error'; source: 'photo' | 'text'; message: string; lost: boolean };

function errorMessage(error: unknown, source: 'photo' | 'text'): { message: string; lost: boolean } {
  if (error instanceof ImageDecodeError) return { message: 'Нужен файл JPEG, PNG или WebP', lost: false };
  if (isApiError(error, TIMEOUT_ERROR) || isApiError(error, NETWORK_ERROR)) {
    return {
      message: 'Не дождались ответа. Проверили дневник: если запись сохранилась, она уже в списке',
      lost: true,
    };
  }
  if (isApiError(error) && error.status === 429) {
    const wait = error.retryAfterSeconds;
    const prefix = source === 'photo' ? 'Слишком много фото подряд' : 'Слишком много запросов подряд';
    return {
      message:
        wait !== null && wait > 0 ? `${prefix}, попробуйте через ${wait} с` : `${prefix}, попробуйте позже`,
      lost: false,
    };
  }
  return { message: userMessage(error), lost: false };
}

export function useMealLogger() {
  const [state, setState] = useState<LoggerState>({ kind: 'idle' });
  const refresh = useRefreshDiary();
  const toast = useToast();
  const previewRef = useRef<string | null>(null);
  const lastFile = useRef<File | null>(null);
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

  const execute = async (
    source: 'photo' | 'text',
    task: () => Promise<MealLogResult>,
    preview: string | null,
  ) => {
    run.current += 1;
    const id = run.current;
    setState({ kind: 'working', source, preview, slow: false });
    try {
      const result = await task();
      if (result.status === 'logged') {
        haptic.success();
        void refresh(result.day);
        if (id !== run.current) toast.show('Фото распознано и записано в дневник');
      }
      if (id === run.current) setState({ kind: 'result', source, result });
    } catch (error) {
      const { message, lost } = errorMessage(error, source);
      if (lost) void refresh();
      if (id === run.current) setState({ kind: 'error', source, message, lost });
    }
  };

  const logFile = async (file: File) => {
    lastFile.current = file;
    releasePreview();
    const preview = URL.createObjectURL(file);
    previewRef.current = preview;
    await execute('photo', async () => logPhoto(await prepareImage(file, PHOTO_MAX_SIDE)), preview);
  };

  return {
    state,
    logFile,
    logText: (description: string) => execute('text', () => logText(description), null),
    retryPhoto: async () => {
      if (lastFile.current !== null) await logFile(lastFile.current);
    },
    reset: () => {
      run.current += 1;
      releasePreview();
      setState({ kind: 'idle' });
    },
  };
}
