import type { OutgoingMessage } from '../ports/messenger.ts';
import { consentButtons, menuButtons } from './keyboards.ts';
import { CONSENT_REQUEST, HELP, SHORT_HELP } from './texts.ts';

export function consentRequest(): OutgoingMessage {
  return { text: CONSENT_REQUEST, buttons: consentButtons() };
}

export function helpMessage(): OutgoingMessage {
  return { text: HELP, buttons: menuButtons() };
}

export function shortHelpMessage(): OutgoingMessage {
  return { text: SHORT_HELP };
}
