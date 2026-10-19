import { can } from '../../domain/roles.ts';
import type { Workplace } from '../../services/access.ts';
import type { Button } from '../../ports/messenger.ts';
import { payload } from '../callbacks.ts';
import { callback, openApp } from '../keyboards.ts';
import { formatStartLink, type StartLink } from '../start-links.ts';
import { VENUE_BUTTONS } from './texts.ts';

const VENUE_PREFIX = 'vn';

export function startLinkUrl(botUsername: string, link: StartLink): string {
  return `https://max.ru/${botUsername}?start=${formatStartLink(link)}`;
}

export function venueButton(text: string, ...parts: readonly (string | number)[]): Button {
  return callback(text, payload(VENUE_PREFIX, ...parts));
}

export function appRow(miniAppEnabled: boolean): Button[][] {
  return miniAppEnabled ? [[openApp(VENUE_BUTTONS.openApp)]] : [];
}

export function homeRow(): Button[] {
  return [venueButton(VENUE_BUTTONS.home, 'home')];
}

export function homeButtons(place: Workplace, miniAppEnabled: boolean, severalVenues: boolean): Button[][] {
  const { role } = place;
  const inCompany = place.company !== null;
  const switchRow = severalVenues ? [[venueButton(VENUE_BUTTONS.switchVenue, 'switch')]] : [];
  if (!can(role, 'menu.edit')) {
    return [
      [venueButton(VENUE_BUTTONS.redeem, 'redeem'), venueButton(VENUE_BUTTONS.bookings, 'bk')],
      [venueButton(VENUE_BUTTONS.deals, 'deals')],
      ...switchRow,
    ];
  }
  const statsRow = [venueButton(VENUE_BUTTONS.stats, 'stats', 'today')];
  if (inCompany && can(role, 'team.invite')) statsRow.push(venueButton(VENUE_BUTTONS.team, 'team'));
  return [
    [venueButton(VENUE_BUTTONS.menu, 'menu'), venueButton(VENUE_BUTTONS.deals, 'deals')],
    [venueButton(VENUE_BUTTONS.bookings, 'bk'), venueButton(VENUE_BUTTONS.redeem, 'redeem')],
    statsRow,
    ...(inCompany && can(role, 'venue.create') ? [[venueButton(VENUE_BUTTONS.create, 'new')]] : []),
    ...switchRow,
    ...appRow(miniAppEnabled),
  ];
}

export function uploadRow(text: string = VENUE_BUTTONS.upload): Button[] {
  return [venueButton(text, 'menu', 'upload')];
}

export function newDealRow(text: string = VENUE_BUTTONS.newDeal): Button[] {
  return [venueButton(text, 'dl', 'new')];
}

export function bookingsRow(): Button[] {
  return [venueButton(VENUE_BUTTONS.bookings, 'bk'), venueButton(VENUE_BUTTONS.redeem, 'redeem')];
}

export function pairs(buttons: readonly Button[]): Button[][] {
  const rows: Button[][] = [];
  for (let index = 0; index < buttons.length; index += 2) rows.push(buttons.slice(index, index + 2));
  return rows;
}
