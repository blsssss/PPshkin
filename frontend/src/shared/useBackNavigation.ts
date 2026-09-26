import { useCallback } from 'react';
import { useNavigate } from 'react-router';
import { useBackButton } from '../max/bridge.ts';
import { hasAppHistory } from './appHistory.ts';
import { closeTopSheet } from './ui/sheetStack.ts';

export function useBackNavigation(fallbackPath: string): () => void {
  const navigate = useNavigate();
  const goBack = useCallback(() => {
    if (closeTopSheet()) return;
    if (hasAppHistory()) void navigate(-1);
    else void navigate(fallbackPath, { replace: true });
  }, [navigate, fallbackPath]);
  useBackButton(goBack);
  return goBack;
}
