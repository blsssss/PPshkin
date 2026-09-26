export interface MaxUser {
  user_id: number;
  first_name?: string | null;
  username?: string | null;
}

export interface MaxMessage {
  sender?: MaxUser | null;
  recipient: { chat_id?: number | null };
  body: {
    mid: string;
    text?: string | null;
    attachments?: unknown[] | null;
  };
}

export interface MaxCallback {
  callback_id: string;
  payload?: string | null;
  user: MaxUser;
}

export interface MaxImageAttachment {
  type: 'image';
  payload: { url: string; token?: string | null };
}

export interface MaxLocationAttachment {
  type: 'location';
  latitude: number;
  longitude: number;
}

export type MaxButton =
  | { type: 'callback'; text: string; payload: string }
  | { type: 'link'; text: string; url: string }
  | { type: 'request_geo_location'; text: string; quick: boolean }
  | { type: 'open_app'; text: string; web_app: string; contact_id: number; payload?: string };

export type MaxAttachmentRequest =
  | { type: 'image'; payload: { token: string } }
  | { type: 'inline_keyboard'; payload: { buttons: MaxButton[][] } };

export interface MaxNewMessageBody {
  text: string;
  attachments?: MaxAttachmentRequest[];
  format?: 'markdown' | 'html';
  notify?: boolean;
}

export interface MaxCallbackAnswer {
  notification?: string;
  message?: MaxNewMessageBody;
}

export interface MaxSubscription {
  url: string;
  time: number;
  update_types?: string[] | null;
}

export interface MaxBotInfo {
  user_id: number;
  first_name: string;
  username: string;
}

export interface MaxBotCommand {
  name: string;
  description: string;
}
