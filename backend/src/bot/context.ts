import type { GeoPoint, User } from '../domain/models.ts';
import type { MaxLogger } from '../integrations/max/poller.ts';
import type {
  CallbackAnswer,
  IncomingEvent,
  Messenger,
  OutgoingMessage,
  SentMessage,
} from '../ports/messenger.ts';
import type { Services } from '../services/index.ts';
import type { StartLink, StartLinkKind } from './start-links.ts';
import type { ChatState, ChatStateStore, FlowName } from './state.ts';

export interface BotContext {
  user: User;
  chatId: number | null;
  now: Date;
  botUsername: string;
  miniAppEnabled: boolean;
  state: ChatState;
  callbackMessageId: string | null;
  saveState(next: ChatState): Promise<void>;
  reply(message: OutgoingMessage): Promise<SentMessage>;
  answer(answer: CallbackAnswer): Promise<void>;
  placeholder(text: string): Promise<void>;
  settle(message: OutgoingMessage): Promise<SentMessage>;
}

export type MessageInput = Extract<IncomingEvent, { type: 'message' }>;

export type CommandHandler = (ctx: BotContext, args: string) => Promise<void>;
export type CallbackHandler = (ctx: BotContext, args: string[]) => Promise<void>;
export type FlowHandler = (ctx: BotContext, message: MessageInput) => Promise<boolean>;
export type StartLinkHandler = (ctx: BotContext, value: string) => Promise<void>;

export interface BotModule {
  commands?: Record<string, CommandHandler>;
  callbacks?: Record<string, CallbackHandler>;
  flows?: Partial<Record<FlowName, FlowHandler>>;
  startLinks?: Partial<Record<StartLinkKind, StartLinkHandler>>;
  location?: (ctx: BotContext, point: GeoPoint) => Promise<void>;
  photos?: (ctx: BotContext, message: MessageInput) => Promise<void>;
  text?: (ctx: BotContext, text: string) => Promise<void>;
}

export interface BotKit {
  services: Services;
  messenger: Messenger;
  states: ChatStateStore;
  logger: MaxLogger;
  openStartLink(ctx: BotContext, link: StartLink): Promise<boolean>;
}
