function minutes(time: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (match === null) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function localMinutes(now: Date, timeZone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
    const hour = Number(parts.find((part) => part.type === 'hour')?.value);
    const minute = Number(parts.find((part) => part.type === 'minute')?.value);
    return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : null;
  } catch {
    return null;
  }
}

export function isOpenNow(opensAt: string, closesAt: string, timeZone: string, now: Date): boolean {
  const open = minutes(opensAt);
  const close = minutes(closesAt);
  const current = localMinutes(now, timeZone);
  if (open === null || close === null || current === null) return false;
  if (open === close) return true;
  if (open < close) return current >= open && current < close;
  return current >= open || current < close;
}
