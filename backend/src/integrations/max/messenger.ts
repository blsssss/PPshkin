import { extname } from 'node:path';
import type { Button, Messenger, OutgoingMessage } from '../../ports/messenger.ts';
import type { MaxApi } from './api.ts';
import type { MaxAttachmentRequest, MaxButton, MaxCallbackAnswer, MaxNewMessageBody } from './types.ts';

interface MaxBotIdentity {
  botUsername: string;
  botUserId: number;
}

const MAX_TEXT_LENGTH = 4000;
const MAX_IMAGES = 12;
const MAX_ROWS = 30;
const MAX_ROW_BUTTONS = 7;
const MAX_WIDE_ROW_BUTTONS = 3;
const MAX_BUTTON_TEXT_LENGTH = 128;
const MAX_CALLBACK_PAYLOAD_LENGTH = 1024;
const MAX_LINK_URL_LENGTH = 2048;
const APP_PAYLOAD = /^[A-Za-z0-9_-]{0,512}$/;
const DOWNLOAD_LIMIT_BYTES = 15 * 1024 * 1024;
const MARKDOWN_SPECIAL = /[\\*_~+`[\]()^#>]/g;
const WIDE_BUTTON_KINDS = new Set<Button['kind']>(['link', 'location', 'app']);
const IMAGE_TYPES = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
]);

export function escapeMarkdown(text: string): string {
  return text.replace(MARKDOWN_SPECIAL, '\\$&');
}

function isHttpUrl(value: string): boolean {
  const url = URL.parse(value);
  return url?.protocol === 'https:' || url?.protocol === 'http:';
}

function checkButton(button: Button, place: string): void {
  if (button.text.length < 1 || button.text.length > MAX_BUTTON_TEXT_LENGTH) {
    throw new Error(`${place} text must be 1 to ${MAX_BUTTON_TEXT_LENGTH} characters long`);
  }
  if (button.kind === 'callback' && button.payload.length > MAX_CALLBACK_PAYLOAD_LENGTH) {
    throw new Error(`${place} payload is longer than ${MAX_CALLBACK_PAYLOAD_LENGTH} characters`);
  }
  if (button.kind === 'link' && (button.url.length > MAX_LINK_URL_LENGTH || !isHttpUrl(button.url))) {
    throw new Error(`${place} needs an http or https URL up to ${MAX_LINK_URL_LENGTH} characters`);
  }
  if (button.kind === 'app' && button.payload !== undefined && !APP_PAYLOAD.test(button.payload)) {
    throw new Error(`${place} payload must match ${APP_PAYLOAD.source}`);
  }
}

function checkKeyboard(rows: Button[][]): void {
  if (rows.length > MAX_ROWS) {
    throw new Error(`Keyboard has ${rows.length} rows, at most ${MAX_ROWS} are allowed`);
  }
  rows.forEach((row, rowIndex) => {
    const wide = row.some((button) => WIDE_BUTTON_KINDS.has(button.kind));
    const limit = wide ? MAX_WIDE_ROW_BUTTONS : MAX_ROW_BUTTONS;
    if (row.length === 0 || row.length > limit) {
      throw new Error(`Keyboard row ${rowIndex + 1} has ${row.length} buttons, 1 to ${limit} are allowed`);
    }
    row.forEach((button, buttonIndex) => {
      checkButton(button, `Button ${buttonIndex + 1} in keyboard row ${rowIndex + 1}`);
    });
  });
}

function checkMessage(message: OutgoingMessage): void {
  if (message.text.length > MAX_TEXT_LENGTH) {
    throw new Error(
      `Message text has ${message.text.length} characters, at most ${MAX_TEXT_LENGTH} are allowed`,
    );
  }
  const images = message.imageTokens?.length ?? 0;
  if (images > MAX_IMAGES) {
    throw new Error(`Message has ${images} images, at most ${MAX_IMAGES} are allowed`);
  }
  checkKeyboard(message.buttons ?? []);
}

export function createMaxMessenger(api: MaxApi, bot: MaxBotIdentity): Messenger {
  const toButton = (button: Button): MaxButton => {
    switch (button.kind) {
      case 'callback':
        return { type: 'callback', text: button.text, payload: button.payload };
      case 'link':
        return { type: 'link', text: button.text, url: button.url };
      case 'location':
        return { type: 'request_geo_location', text: button.text, quick: false };
      case 'app':
        return {
          type: 'open_app',
          text: button.text,
          web_app: bot.botUsername,
          contact_id: bot.botUserId,
          ...(button.payload === undefined ? {} : { payload: button.payload }),
        };
    }
  };

  const toAttachments = (message: OutgoingMessage): MaxAttachmentRequest[] => {
    const images = (message.imageTokens ?? []).map((token): MaxAttachmentRequest => ({
      type: 'image',
      payload: { token },
    }));
    const rows = message.buttons ?? [];
    if (rows.length === 0) return images;
    return [
      ...images,
      { type: 'inline_keyboard', payload: { buttons: rows.map((row) => row.map(toButton)) } },
    ];
  };

  const toBody = (message: OutgoingMessage, replacing: boolean): MaxNewMessageBody => {
    checkMessage(message);
    const attachments = toAttachments(message);
    return {
      text: message.text,
      format: message.format ?? 'markdown',
      ...(message.notify === undefined ? {} : { notify: message.notify }),
      ...(replacing || attachments.length > 0 ? { attachments } : {}),
    };
  };

  return {
    async sendToUser(userId, message) {
      const { mid } = await api.sendMessage({ userId }, toBody(message, false));
      return { messageId: mid };
    },

    async editMessage(messageId, message) {
      await api.editMessage(messageId, toBody(message, true));
    },

    async answerCallback(callbackId, answer) {
      const body: MaxCallbackAnswer = {
        ...(answer.notification === undefined ? {} : { notification: answer.notification }),
        ...(answer.message === undefined ? {} : { message: toBody(answer.message, true) }),
      };
      await api.answerCallback(callbackId, body);
    },

    async uploadImage(data, filename) {
      const contentType = IMAGE_TYPES.get(extname(filename).toLowerCase());
      if (!contentType) throw new Error('Only .png, .jpg and .jpeg images can be uploaded');
      return api.uploadImage(data, filename, contentType);
    },

    async sendTyping(chatId) {
      await api.sendAction(chatId, 'typing_on').catch(() => undefined);
    },

    downloadFile: (url) => api.download(url, DOWNLOAD_LIMIT_BYTES),
  };
}
