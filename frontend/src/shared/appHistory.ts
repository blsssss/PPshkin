import { useEffect } from 'react';
import { NavigationType, useLocation, useNavigate, useNavigationType } from 'react-router';

const entries: string[] = [];

export function useTrackAppHistory(): void {
  const { key, pathname } = useLocation();
  const type = useNavigationType();
  useEffect(() => {
    if (key === 'default') entries.splice(0, entries.length, pathname);
    else if (type === NavigationType.Push || entries.length === 0) entries.push(pathname);
    else if (type === NavigationType.Replace) entries[entries.length - 1] = pathname;
    else {
      const index = entries.lastIndexOf(pathname);
      if (index >= 0) entries.length = index + 1;
      else entries[entries.length - 1] = pathname;
    }
  }, [key, pathname, type]);
}

export function hasAppHistory(): boolean {
  return entries.length > 1;
}

export function useLeave(): (target: string) => void {
  const navigate = useNavigate();
  return (target) => {
    if (entries.at(-2) === target) void navigate(-1);
    else void navigate(target, { replace: true });
  };
}
