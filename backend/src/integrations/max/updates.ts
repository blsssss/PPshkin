import { z } from 'zod';
import type { GeoPoint } from '../../domain/models.ts';
import type { IncomingEvent, IncomingPhoto, MessengerUser } from '../../ports/messenger.ts';
import type { MaxCallback, MaxImageAttachment, MaxLocationAttachment, MaxMessage, MaxUser } from './types.ts';

export const MAX_UPDATE_TYPES = [
  'bot_started',
  'message_created',
  'message_callback',
  'bot_stopped',
] as const;
export type MaxUpdateType = (typeof MAX_UPDATE_TYPES)[number];

const UserSchema: z.ZodType<MaxUser> = z.object({
  user_id: z.number().int().positive(),
  first_name: z.string().nullish(),
  username: z.string().nullish(),
});

const MessageSchema: z.ZodType<MaxMessage> = z.object({
  sender: UserSchema.nullish(),
  recipient: z.object({ chat_id: z.number().int().nullish() }),
  body: z.object({
    mid: z.string().min(1),
    text: z.string().nullish(),
    attachments: z.array(z.unknown()).nullish(),
  }),
});

const CallbackSchema: z.ZodType<MaxCallback> = z.object({
  callback_id: z.string().min(1),
  payload: z.string().nullish(),
  user: UserSchema,
});

const ImageAttachmentSchema: z.ZodType<MaxImageAttachment> = z.object({
  type: z.literal('image'),
  payload: z.object({ url: z.string().min(1), token: z.string().nullish() }),
});

const LocationAttachmentSchema: z.ZodType<MaxLocationAttachment> = z.object({
  type: z.literal('location'),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

const timestamp = z.number().int().nonnegative();

const UpdateSchema = z.discriminatedUnion('update_type', [
  z.object({
    update_type: z.literal('bot_started'),
    timestamp,
    chat_id: z.number().int(),
    user: UserSchema,
    payload: z.string().nullish(),
  }),
  z.object({
    update_type: z.literal('message_created'),
    timestamp,
    message: MessageSchema.nullish(),
  }),
  z.object({
    update_type: z.literal('message_callback'),
    timestamp,
    callback: CallbackSchema,
    message: MessageSchema.nullish().catch(null),
  }),
  z.object({
    update_type: z.literal('bot_stopped'),
    timestamp,
    chat_id: z.number().int(),
    user: UserSchema,
  }),
]);

type Update = z.infer<typeof UpdateSchema>;

function eventKey(updateType: MaxUpdateType, id: string | number, time: number): string {
  return `${updateType}:${id}:${time}`;
}

function toUser(user: MaxUser): MessengerUser {
  return { id: user.user_id, firstName: user.first_name ?? null, username: user.username ?? null };
}

function toPhotos(attachments: unknown[]): IncomingPhoto[] {
  return attachments.flatMap((attachment) => {
    const parsed = ImageAttachmentSchema.safeParse(attachment);
    return parsed.success ? [{ url: parsed.data.payload.url, token: parsed.data.payload.token ?? null }] : [];
  });
}

function toLocation(attachments: unknown[]): GeoPoint | null {
  for (const attachment of attachments) {
    const parsed = LocationAttachmentSchema.safeParse(attachment);
    if (parsed.success) return { lat: parsed.data.latitude, lon: parsed.data.longitude };
  }
  return null;
}

function toMessageEvent(message: MaxMessage | null | undefined, time: number): IncomingEvent | null {
  const chatId = message?.recipient.chat_id;
  if (!message?.sender || chatId === null || chatId === undefined) return null;
  const attachments = message.body.attachments ?? [];
  const text = message.body.text?.trim() ?? '';
  return {
    type: 'message',
    key: eventKey('message_created', message.body.mid, time),
    user: toUser(message.sender),
    chatId,
    messageId: message.body.mid,
    text: text.length > 0 ? text : null,
    photos: toPhotos(attachments),
    location: toLocation(attachments),
  };
}

function toEvent(update: Update): IncomingEvent | null {
  switch (update.update_type) {
    case 'bot_started':
      return {
        type: 'started',
        key: eventKey(update.update_type, update.chat_id, update.timestamp),
        user: toUser(update.user),
        chatId: update.chat_id,
        payload: update.payload ?? null,
      };
    case 'message_created':
      return toMessageEvent(update.message, update.timestamp);
    case 'message_callback':
      return {
        type: 'callback',
        key: eventKey(update.update_type, update.callback.callback_id, update.timestamp),
        user: toUser(update.callback.user),
        chatId: update.message?.recipient.chat_id ?? null,
        callbackId: update.callback.callback_id,
        payload: update.callback.payload ?? '',
        messageId: update.message?.body.mid ?? null,
      };
    case 'bot_stopped':
      return {
        type: 'stopped',
        key: eventKey(update.update_type, update.chat_id, update.timestamp),
        user: toUser(update.user),
      };
  }
}

export function updateTypeOf(raw: unknown): string | null {
  const type = typeof raw === 'object' && raw !== null && 'update_type' in raw ? raw.update_type : null;
  return typeof type === 'string' ? type : null;
}

export function parseUpdate(raw: unknown): IncomingEvent | null {
  try {
    const parsed = UpdateSchema.safeParse(raw);
    return parsed.success ? toEvent(parsed.data) : null;
  } catch {
    return null;
  }
}
