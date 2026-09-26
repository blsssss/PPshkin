import { TAG_LABELS, type Tag } from '../../domain/vocabulary.ts';
import type { Button } from '../../ports/messenger.ts';
import { payload } from '../callbacks.ts';
import { callback, command, locationRequest } from '../keyboards.ts';
import { BUTTONS } from '../texts.ts';
import { dislikeTag, OFFER_BUTTONS } from './offer-texts.ts';

const TAG_BUTTONS_LIMIT = 3;
const TAG_SEPARATOR = ',';

export function bookButton(
  text: string,
  item: { menuItemId: number; dealId: number | null; offerId: number | null },
): Button {
  return callback(text, payload('bk', 'new', item.menuItemId, item.dealId ?? 0, item.offerId ?? 0));
}

export function offerActionButtons(offerId: number, tags: readonly Tag[]): Button[] {
  return [
    callback(OFFER_BUTTONS.other, payload('of', 'next', offerId)),
    callback(OFFER_BUTTONS.notToday, payload('of', 'nt', offerId)),
    callback(OFFER_BUTTONS.dislike, payload('of', 'dl', offerId, ...joinedTags(tags))),
  ];
}

export function elsewhereButtons(): Button[][] {
  return [[locationRequest(OFFER_BUTTONS.elsewhere)]];
}

export function demoDiaryButtons(): Button[][] {
  return [[callback(OFFER_BUTTONS.demoDiary, payload('of', 'demo'))]];
}

export function stopHintsButtons(): Button[][] {
  return [[callback(OFFER_BUTTONS.stopHints, payload('cs', 'ad', 'off'))]];
}

export function eatLocationButtons(): Button[][] {
  return [[locationRequest(BUTTONS.sendLocation)], [callback(OFFER_BUTTONS.anywhere, payload('of', 'any'))]];
}

export function nothingFitsButtons(nearby: boolean): Button[][] {
  return [
    [locationRequest(nearby ? BUTTONS.updateLocation : BUTTONS.sendLocation)],
    [command(BUTTONS.profile, 'profile')],
  ];
}

export function dislikeButtons(offered: readonly Tag[], disliked: readonly Tag[]): Button[][] {
  return offered
    .filter((tag) => !disliked.includes(tag))
    .slice(0, TAG_BUTTONS_LIMIT)
    .map((tag) => [
      callback(dislikeTag(TAG_LABELS[tag]), payload('pf', 'tag', 'add', tag, ...joinedTags(offered))),
    ]);
}

export function splitTags(value: string | undefined): string[] {
  return (value ?? '').split(TAG_SEPARATOR);
}

function joinedTags(tags: readonly Tag[]): string[] {
  return tags.length > 0 ? [tags.join(TAG_SEPARATOR)] : [];
}

export function bookingButtons(options: {
  bookingId: number;
  showQr: boolean;
  place: Button[][];
}): Button[][] {
  return [
    ...(options.showQr ? [[callback(OFFER_BUTTONS.showQr, payload('bk', 'qr', options.bookingId))]] : []),
    ...options.place,
    [callback(OFFER_BUTTONS.cancelBooking, payload('bk', 'cancel', options.bookingId))],
  ];
}

export function cancelBookingButtons(bookingId: number): Button[][] {
  return [
    [
      callback(OFFER_BUTTONS.confirmCancel, payload('bk', 'cancel_ok', bookingId)),
      callback(OFFER_BUTTONS.keepBooking, payload('bk', 'keep', bookingId)),
    ],
  ];
}
