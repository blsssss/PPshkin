import { useEffect } from 'react';
import { Navigate } from 'react-router';
import { session } from '../api/index.ts';
import { useToast } from '../shared/ui/Toast.tsx';
import { resolveStartParam } from './startParam.ts';

export function StartRedirect() {
  const toast = useToast();
  const param = session.pendingStartParam();
  const target = resolveStartParam(param);

  useEffect(() => {
    if (param === null || !session.markStartHandled()) return;
    if (!target.recognized) toast.show('Ссылка не распознана');
  }, [param, target.recognized, toast]);

  return <Navigate to={target.path} replace />;
}
