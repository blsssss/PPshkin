import { useEffect, useState } from 'react';
import { ApiError } from '../api/errors.ts';

function deadline(error: unknown): number | null {
  if (!(error instanceof ApiError) || error.status !== 429) return null;
  if (error.retryAfterSeconds === null || error.retryAfterSeconds <= 0) return null;
  return error.receivedAt + error.retryAfterSeconds * 1000;
}

export function useCooldown(error: unknown): number {
  const until = deadline(error);
  const [now, setNow] = useState(Date.now);
  const left = until === null ? 0 : Math.max(0, Math.ceil((until - now) / 1000));

  useEffect(() => {
    if (until === null) return;
    const tick = () => {
      setNow(Date.now());
    };
    const timer = setInterval(tick, 1000);
    const first = setTimeout(tick, 0);
    return () => {
      clearInterval(timer);
      clearTimeout(first);
    };
  }, [until]);

  return left;
}
