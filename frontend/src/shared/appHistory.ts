import { useEffect } from 'react';
import { NavigationType, useLocation, useNavigate, useNavigationType } from 'react-router';

interface Entry {
  key: string;
  pathname: string;
}

const entries: Entry[] = [];

export function useTrackAppHistory(): void {
  const { key, pathname } = useLocation();
  const type = useNavigationType();
  useEffect(() => {
    const entry = { key, pathname };
    if (key === 'default' || entries.length === 0) {
      entries.splice(0, entries.length, entry);
    } else if (type === NavigationType.Push) {
      entries.push(entry);
    } else if (type === NavigationType.Replace) {
      entries[entries.length - 1] = entry;
    } else {
      const index = entries.findLastIndex((item) => item.key === key);
      if (index >= 0) entries.length = index + 1;
      else entries.splice(0, entries.length, entry);
    }
  }, [key, pathname, type]);
}

export function hasAppHistory(): boolean {
  return entries.length > 1;
}

export function useLeave(): (target: string) => void {
  const navigate = useNavigate();
  return (target) => {
    if (entries.at(-2)?.pathname === target) void navigate(-1);
    else void navigate(target, { replace: true });
  };
}
