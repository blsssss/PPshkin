import type {
  BotContext,
  BotModule,
  CallbackHandler,
  CommandHandler,
  FlowHandler,
  StartLinkHandler,
} from './context.ts';
import type { StartLink, StartLinkKind } from './start-links.ts';
import type { FlowName } from './state.ts';

export const COMMAND_PREFIX = 'cmd';

type MessageHandlers = Pick<BotModule, 'location' | 'photos' | 'text'>;

export interface Registry {
  add(module: BotModule): void;
  command(name: string): CommandHandler | undefined;
  callback(prefix: string): CallbackHandler | undefined;
  flow(name: FlowName): FlowHandler | undefined;
  messages(): MessageHandlers;
  openStartLink(ctx: BotContext, link: StartLink): Promise<boolean>;
}

const PREFIX = /^[a-z]{2,8}$/;
const COMMAND = /^[a-z_]{1,32}$/;

function include<Key extends string, Handler>(
  target: Map<Key, Handler>,
  entries: Partial<Record<Key, Handler>> | undefined,
  kind: string,
  check: (key: Key) => boolean = () => true,
): void {
  for (const [key, handler] of Object.entries(entries ?? {}) as [Key, Handler | undefined][]) {
    if (handler === undefined) continue;
    if (!check(key)) throw new Error(`${kind} "${key}" has an invalid name`);
    if (target.has(key)) throw new Error(`${kind} "${key}" is registered by two bot modules`);
    target.set(key, handler);
  }
}

function single<Handler>(current: Handler | undefined, next: Handler | undefined, kind: string) {
  if (next === undefined) return current;
  if (current !== undefined) throw new Error(`${kind} handler is registered by two bot modules`);
  return next;
}

export function createRegistry(): Registry {
  const commands = new Map<string, CommandHandler>();
  const callbacks = new Map<string, CallbackHandler>();
  const flows = new Map<FlowName, FlowHandler>();
  const startLinks = new Map<StartLinkKind, StartLinkHandler>();
  const messages: MessageHandlers = {};

  return {
    add(module) {
      include(commands, module.commands, 'Command', (name) => COMMAND.test(name));
      include(
        callbacks,
        module.callbacks,
        'Callback prefix',
        (prefix) => PREFIX.test(prefix) && prefix !== COMMAND_PREFIX,
      );
      include(flows, module.flows, 'Flow');
      include(startLinks, module.startLinks, 'Start link');
      messages.location = single(messages.location, module.location, 'Location');
      messages.photos = single(messages.photos, module.photos, 'Photo');
      messages.text = single(messages.text, module.text, 'Text');
    },
    command: (name) => commands.get(name),
    callback: (prefix) => callbacks.get(prefix),
    flow: (name) => flows.get(name),
    messages: () => messages,
    async openStartLink(ctx, link) {
      const handler = startLinks.get(link.kind);
      if (!handler) return false;
      await handler(ctx, link.value);
      return true;
    },
  };
}
