import type { GeoPoint } from '../domain/models.ts';
import { GOALS } from '../domain/vocabulary.ts';
import type { Button } from '../ports/messenger.ts';
import { payload } from './callbacks.ts';
import { BUTTONS, capitalize, GOAL_LABELS } from './texts.ts';

export type Origin = 'ob' | 'pf';

const KCAL_CHOICES = [1600, 1800, 2000, 2200, 2500] as const;

export function callback(text: string, value: string): Button {
  return { kind: 'callback', text, payload: value };
}

export function link(text: string, url: string): Button {
  return { kind: 'link', text, url };
}

export function locationRequest(text: string): Button {
  return { kind: 'location', text };
}

export function openApp(text: string): Button {
  return { kind: 'app', text };
}

export function command(text: string, name: string): Button {
  return callback(text, payload('cmd', name));
}

export function routeUrl({ lat, lon }: GeoPoint): string {
  return `https://yandex.ru/maps/?pt=${lon},${lat}&z=17&l=map`;
}

export function miniAppUrl(botUsername: string, startParam: string): string {
  return `https://max.ru/${botUsername}?startapp=${startParam}`;
}

export function consentButtons(): Button[][] {
  return [
    [callback(BUTTONS.agree, payload('cs', 'pd', 'ok')), callback(BUTTONS.more, payload('cs', 'pd', 'more'))],
  ];
}

export function agreeButtons(): Button[][] {
  return [[callback(BUTTONS.agree, payload('cs', 'pd', 'ok'))]];
}

export function offersButtons(origin: Origin): Button[][] {
  const [yes, no] =
    origin === 'ob' ? [BUTTONS.offersYes, BUTTONS.offersNo] : [BUTTONS.offersAgree, BUTTONS.cancel];
  return [
    [callback(yes, payload('cs', 'ad', 'yes', origin)), callback(no, payload('cs', 'ad', 'no', origin))],
  ];
}

export function goalButtons(origin: Origin): Button[][] {
  return [
    ...GOALS.map((goal) => [callback(capitalize(GOAL_LABELS[goal]), payload(origin, 'goal', goal))]),
    [callback(BUTTONS.skip, payload(origin, 'goal', 'skip'))],
  ];
}

export function kcalButtons(origin: Origin, miniAppEnabled: boolean): Button[][] {
  return [
    KCAL_CHOICES.map((kcal) => callback(String(kcal), payload(origin, 'kcal', kcal))),
    [callback(BUTTONS.customKcal, payload(origin, 'kcal', 'custom'))],
    ...(miniAppEnabled ? [[openApp(BUTTONS.calculate)]] : []),
  ];
}

export function onboardingLocationButtons(): Button[][] {
  return [[locationRequest(BUTTONS.sendLocation)], [callback(BUTTONS.skip, payload('ob', 'loc', 'skip'))]];
}

export function menuButtons(): Button[][] {
  return [[command(BUTTONS.today, 'today'), command(BUTTONS.profile, 'profile')]];
}

export function helpButtons(): Button[][] {
  return [[command(BUTTONS.help, 'help')]];
}

export function placeButtons(options: {
  location: GeoPoint;
  botUsername: string;
  miniAppEnabled: boolean;
  appLabel: string;
  startParam: string;
}): Button[][] {
  const route = link(BUTTONS.route, routeUrl(options.location));
  if (!options.miniAppEnabled) return [[route]];
  return [[route, link(options.appLabel, miniAppUrl(options.botUsername, options.startParam))]];
}
