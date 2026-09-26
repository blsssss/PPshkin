import type { UserProfile } from '../../api/client.ts';
import type { Goal } from '../../shared/vocabulary.ts';

export const RUSSIAN_TIME_ZONES = [
  { zone: 'Europe/Kaliningrad', label: 'Калининград, UTC+2' },
  { zone: 'Europe/Moscow', label: 'Москва, UTC+3' },
  { zone: 'Europe/Samara', label: 'Самара, UTC+4' },
  { zone: 'Asia/Yekaterinburg', label: 'Екатеринбург, UTC+5' },
  { zone: 'Asia/Omsk', label: 'Омск, UTC+6' },
  { zone: 'Asia/Novosibirsk', label: 'Новосибирск, UTC+7' },
  { zone: 'Asia/Krasnoyarsk', label: 'Красноярск, UTC+7' },
  { zone: 'Asia/Irkutsk', label: 'Иркутск, UTC+8' },
  { zone: 'Asia/Yakutsk', label: 'Якутск, UTC+9' },
  { zone: 'Asia/Vladivostok', label: 'Владивосток, UTC+10' },
  { zone: 'Asia/Magadan', label: 'Магадан, UTC+11' },
  { zone: 'Asia/Kamchatka', label: 'Камчатка, UTC+12' },
] as const;

export const MAX_DISLIKED_TAGS = 20;

export interface ProfileForm {
  kcalTarget: string;
  goal: Goal | null;
  timezone: string;
}

export function formFromProfile(profile: UserProfile): ProfileForm {
  return { kcalTarget: String(profile.kcalTarget), goal: profile.goal, timezone: profile.timezone };
}

export function profilePatch(
  form: { kcalTarget: number; goal: Goal | null; timezone: string },
  profile: UserProfile,
): { kcalTarget?: number; goal?: Goal | null; timezone?: string } {
  return {
    ...(form.kcalTarget === profile.kcalTarget ? {} : { kcalTarget: form.kcalTarget }),
    ...(form.goal === profile.goal ? {} : { goal: form.goal }),
    ...(form.timezone === profile.timezone ? {} : { timezone: form.timezone }),
  };
}

export function timeZoneLabel(zone: string): string {
  return RUSSIAN_TIME_ZONES.find((item) => item.zone === zone)?.label ?? zone;
}

const relative = new Intl.RelativeTimeFormat('ru', { numeric: 'auto' });

export function updatedAgo(iso: string, now: Date): string {
  const minutes = Math.round((new Date(iso).getTime() - now.getTime()) / 60_000);
  if (minutes > -1) return 'только что';
  if (minutes > -60) return relative.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relative.format(hours, 'hour');
  return relative.format(Math.round(hours / 24), 'day');
}

const dayFormat = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });

export function grantedLine(grantedAt: string | null, version: string | null): string {
  const parts = [grantedAt === null ? 'Дано' : `Дано ${dayFormat.format(new Date(grantedAt))}`];
  if (version !== null) parts.push(`редакция ${version}`);
  return parts.join(', ');
}
