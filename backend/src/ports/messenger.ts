import type { GeoPoint } from '../domain/models.ts';

export type Button =
  | { kind: 'callback'; text: string; payload: string }
  | { kind: 'link'; text: string; url: string }
  | { kind: 'location'; text: string }
  | { kind: 'app'; text: string; payload?: string };

export interface OutgoingMessage {
  text: string;
  format?: 'markdown' | 'html';
  buttons?: Button[][];
  imageTokens?: string[];
  notify?: boolean;
}

export interface SentMessage {
  messageId: string;
}

export interface CallbackAnswer {
  notification?: string;
  message?: OutgoingMessage;
}

export interface Messenger {
  sendToUser(userId: number, message: OutgoingMessage): Promise<SentMessage>;
  editMessage(messageId: string, message: OutgoingMessage): Promise<void>;
  answerCallback(callbackId: string, answer: CallbackAnswer): Promise<void>;
  uploadImage(data: Buffer, filename: string): Promise<string>;
  sendTyping(chatId: number): Promise<void>;
  downloadFile(url: string): Promise<Buffer>;
}

export interface MessengerUser {
  id: number;
  firstName: string | null;
  username: string | null;
}

export interface IncomingPhoto {
  url: string;
  token: string | null;
}

export type IncomingEvent =
  | { type: 'started'; key: string; user: MessengerUser; chatId: number; payload: string | null }
  | {
      type: 'message';
      key: string;
      user: MessengerUser;
      chatId: number;
      messageId: string;
      text: string | null;
      photos: IncomingPhoto[];
      location: GeoPoint | null;
    }
  | {
      type: 'callback';
      key: string;
      user: MessengerUser;
      chatId: number | null;
      callbackId: string;
      payload: string;
      messageId: string | null;
    }
  | { type: 'stopped'; key: string; user: MessengerUser };
