import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useBlocker } from 'react-router';
import { setClosingConfirmation } from '../max/bridge.ts';
import { ConfirmSheet } from './ui/ConfirmSheet.tsx';

export function useUnsavedChanges(dirty: boolean): { prompt: ReactNode; release: () => void } {
  const released = useRef(false);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && !released.current && currentLocation.pathname !== nextLocation.pathname,
  );

  useEffect(() => {
    setClosingConfirmation(dirty);
    if (dirty) released.current = false;
  }, [dirty]);

  useEffect(
    () => () => {
      setClosingConfirmation(false);
    },
    [],
  );

  const release = useCallback(() => {
    released.current = true;
    setClosingConfirmation(false);
  }, []);

  const prompt = (
    <ConfirmSheet
      open={blocker.state === 'blocked'}
      title="Уйти без сохранения?"
      description="Изменения на этом экране не сохранятся."
      confirmLabel="Уйти"
      cancelLabel="Остаться"
      destructive
      onConfirm={() => {
        release();
        blocker.proceed?.();
      }}
      onCancel={() => {
        blocker.reset?.();
      }}
    />
  );

  return { prompt, release };
}
