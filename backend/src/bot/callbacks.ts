import type { BotContext, CallbackHandler } from './context.ts';
import { NOTICES } from './texts.ts';

const SEPARATOR = ':';
const PAYLOAD_LIMIT = 1024;
const PRINTABLE_ASCII = /^[\x21-\x7e]+$/;
const ID = /^[1-9]\d{0,14}$/;

export interface CallbackRoute {
  prefix: string;
  args: string[];
}

export function payload(...parts: readonly (string | number)[]): string {
  const value = parts.join(SEPARATOR);
  if (value.length > PAYLOAD_LIMIT || !PRINTABLE_ASCII.test(value)) {
    throw new Error(`Callback payload must be printable ASCII up to ${PAYLOAD_LIMIT} characters`);
  }
  return value;
}

export function parsePayload(raw: string): CallbackRoute | null {
  if (raw.length > PAYLOAD_LIMIT || !PRINTABLE_ASCII.test(raw)) return null;
  const [prefix = '', ...args] = raw.split(SEPARATOR);
  return prefix === '' ? null : { prefix, args };
}

export function parseId(value: string | undefined): number | null {
  return value !== undefined && ID.test(value) ? Number(value) : null;
}

export async function answerStale(ctx: BotContext): Promise<void> {
  await ctx.answer({ notification: NOTICES.staleButton });
}

export function byAction(actions: Readonly<Record<string, CallbackHandler>>): CallbackHandler {
  return async (ctx, [action = '', ...rest]) => {
    const handler = Object.hasOwn(actions, action) ? actions[action] : undefined;
    if (handler) await handler(ctx, rest);
    else await answerStale(ctx);
  };
}
