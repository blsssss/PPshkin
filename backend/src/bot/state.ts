import { z } from 'zod';
import type { Queryable } from '../db/pool.ts';
import { onlyKnownTags } from '../domain/vocabulary.ts';
import * as chatStates from '../repositories/chat-states.ts';
import { isLocalDate } from '../shared/time.ts';
import { OfferQueueSchema } from './guest/offer-card.ts';

export const FLOW_TTL_MS = 30 * 60_000;

const MealCandidateSchema = z.object({
  title: z.string().min(1),
  portionG: z.number().nullable(),
  kcalMin: z.number().int().nonnegative(),
  kcalMax: z.number().int().nonnegative(),
  proteinG: z.number().nonnegative(),
  fatG: z.number().nonnegative(),
  carbsG: z.number().nonnegative(),
  tags: z.array(z.string()).transform(onlyKnownTags),
  confidence: z.number().min(0).max(1),
});

const messageId = z.string().min(1);

const FlowSchema = z.discriminatedUnion('name', [
  z.object({ name: z.literal('kcal_input'), from: z.enum(['ob', 'pf']) }),
  z.object({ name: z.literal('onboarding_location') }),
  z.object({ name: z.literal('eat_location') }),
  z.object({ name: z.literal('meal_fix'), mealId: z.number().int().positive() }),
  z.object({ name: z.literal('meal_manual') }),
  z.object({ name: z.literal('meal_text_confirm'), text: z.string().min(1), messageId }),
  z.object({
    name: z.literal('meal_candidates'),
    candidates: z.array(MealCandidateSchema).min(1),
    messageId,
  }),
]);

const ActiveFlowSchema = FlowSchema.and(z.object({ expiresAt: z.iso.datetime() }));

const ChatStateSchema = z.object({
  flow: ActiveFlowSchema.nullable().default(null),
  offerQueue: OfferQueueSchema.nullable().default(null),
  pendingStart: z.string().max(128).nullable().default(null),
  contextualOfferOn: z.string().refine(isLocalDate).nullable().default(null),
});

export type MealCandidate = z.infer<typeof MealCandidateSchema>;
export type Flow = z.infer<typeof FlowSchema>;
export type FlowName = Flow['name'];
export type ActiveFlow = z.infer<typeof ActiveFlowSchema>;
export type ChatState = z.infer<typeof ChatStateSchema>;

export const EMPTY_CHAT_STATE: Readonly<ChatState> = Object.freeze({
  flow: null,
  offerQueue: null,
  pendingStart: null,
  contextualOfferOn: null,
});

export function parseChatState(raw: unknown): ChatState {
  const parsed = ChatStateSchema.safeParse(raw);
  return parsed.success ? parsed.data : { ...EMPTY_CHAT_STATE };
}

export function startFlow(flow: Flow, now: Date): ActiveFlow {
  return { ...flow, expiresAt: new Date(now.getTime() + FLOW_TTL_MS).toISOString() };
}

export function isExpired(flow: ActiveFlow, now: Date): boolean {
  return Date.parse(flow.expiresAt) <= now.getTime();
}

export interface ChatStateStore {
  load(userId: number): Promise<ChatState>;
  save(userId: number, state: ChatState): Promise<void>;
  clear(userId: number): Promise<void>;
}

export function createChatStateStore(db: Queryable): ChatStateStore {
  return {
    load: async (userId) => parseChatState(await chatStates.load(db, userId)),
    save: (userId, state) => chatStates.save(db, userId, state),
    clear: (userId) => chatStates.clear(db, userId),
  };
}
