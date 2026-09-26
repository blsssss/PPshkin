import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useBlocker } from 'react-router';
import { useClosingConfirmation } from '../max/bridge.ts';
import { ConfirmSheet } from './ui/ConfirmSheet.tsx';

export function useUnsavedChanges(dirty: boolean): { prompt: ReactNode; release: () => void } {
  const releasedRef = useRef(false);
  useClosingConfirmation(dirty);

  useEffect(() => {
    if (dirty) releasedRef.current = false;
  }, [dirty]);

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && !releasedRef.current && currentLocation.pathname !== nextLocation.pathname,
  );

  const release = useCallback(() => {
    releasedRef.current = true;
  }, []);

  const prompt = (
    <ConfirmSheet
      open={blocker.state === 'blocked'}
      title="Изменения не сохранены. Уйти?"
      description="Всё, что вы изменили на этом экране, пропадёт."
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
