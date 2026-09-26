import { PROFILE_LIMITS } from '../../domain/profile.ts';
import { GOALS, TAG_LABELS, type Goal } from '../../domain/vocabulary.ts';
import type { OutgoingMessage } from '../../ports/messenger.ts';
import type { Profile, ProfileService } from '../../services/profile.ts';
import { answerStale, byAction, parseId, payload } from '../callbacks.ts';
import type { BotContext, BotKit, BotModule } from '../context.ts';
import { callback, goalButtons, kcalButtons, locationRequest, offersButtons } from '../keyboards.ts';
import { startFlow } from '../state.ts';
import {
  ACCOUNT_DELETED,
  ACCOUNT_KEPT,
  BUTTONS,
  calendarDate,
  DELETE_QUESTION,
  GOAL_QUESTION,
  KCAL_PROMPT,
  kcalQuestion,
  LOCATION_UPDATED,
  OFFERS_QUESTION,
  profileText,
} from '../texts.ts';

export function isGoal(value: string | undefined): value is Goal {
  return GOALS.some((goal) => goal === value);
}

export function renderProfile({ user, consents }: Profile): OutgoingMessage {
  const offersEnabled = consents.personalizedOffers.granted;
  const text = profileText({
    kcalTarget: user.kcalTarget,
    goal: user.goal,
    offersEnabled,
    locationUpdated: user.locationUpdatedAt ? calendarDate(user.locationUpdatedAt, user.timezone) : null,
    disliked: user.dislikedTags.map((tag) => TAG_LABELS[tag]),
  });
  return {
    text,
    buttons: [
      [callback(BUTTONS.target, payload('pf', 'kcal')), callback(BUTTONS.goal, payload('pf', 'goal'))],
      [
        offersEnabled
          ? callback(BUTTONS.offersOff, payload('cs', 'ad', 'off'))
          : callback(BUTTONS.offersOn, payload('pf', 'ad', 'on')),
      ],
      [locationRequest(user.location ? BUTTONS.updateLocation : BUTTONS.sendLocation)],
      ...(user.dislikedTags.length > 0
        ? [[callback(BUTTONS.resetDisliked, payload('pf', 'tags', 'reset'))]]
        : []),
      [callback(BUTTONS.deleteAccount, payload('ac', 'del'))],
    ],
  };
}

export async function profileMessage(profile: ProfileService, userId: number): Promise<OutgoingMessage> {
  return renderProfile(await profile.get(userId));
}

function deleteQuestion(): OutgoingMessage {
  return {
    text: DELETE_QUESTION,
    buttons: [
      [
        callback(BUTTONS.confirmDelete, payload('ac', 'del_ok')),
        callback(BUTTONS.cancel, payload('ac', 'del_no')),
      ],
    ],
  };
}

export function parseKcalChoice(value: string | undefined): number | null {
  const kcal = parseId(value);
  return kcal !== null && kcal >= PROFILE_LIMITS.kcalTargetMin && kcal <= PROFILE_LIMITS.kcalTargetMax
    ? kcal
    : null;
}

export function createProfileModule({ services, states }: BotKit): BotModule {
  const { profile, account } = services;

  async function changeTarget(ctx: BotContext, [value]: string[]): Promise<void> {
    if (value === undefined) {
      await ctx.answer({
        message: { text: kcalQuestion(false), buttons: kcalButtons('pf', ctx.miniAppEnabled) },
      });
      return;
    }
    if (value === 'custom') {
      await ctx.saveState({ ...ctx.state, flow: startFlow({ name: 'kcal_input', from: 'pf' }, ctx.now) });
      await ctx.answer({ message: { text: KCAL_PROMPT } });
      return;
    }
    const kcalTarget = parseKcalChoice(value);
    if (kcalTarget === null) {
      await answerStale(ctx);
      return;
    }
    await ctx.answer({ message: renderProfile(await profile.update(ctx.user.id, { kcalTarget })) });
  }

  async function changeGoal(ctx: BotContext, [value]: string[]): Promise<void> {
    if (value === undefined) {
      await ctx.answer({ message: { text: GOAL_QUESTION, buttons: goalButtons('pf') } });
    } else if (value === 'skip') {
      await ctx.answer({ message: await profileMessage(profile, ctx.user.id) });
    } else if (isGoal(value)) {
      await ctx.answer({ message: renderProfile(await profile.update(ctx.user.id, { goal: value })) });
    } else {
      await answerStale(ctx);
    }
  }

  return {
    commands: {
      profile: async (ctx) => {
        await ctx.reply(await profileMessage(profile, ctx.user.id));
      },
      delete: async (ctx) => {
        await ctx.reply(deleteQuestion());
      },
    },
    callbacks: {
      pf: byAction({
        kcal: changeTarget,
        goal: changeGoal,
        ad: byAction({
          on: async (ctx) => {
            await ctx.answer({ message: { text: OFFERS_QUESTION, buttons: offersButtons('pf') } });
          },
        }),
        tags: byAction({
          reset: async (ctx) => {
            await ctx.answer({
              message: renderProfile(await profile.update(ctx.user.id, { dislikedTags: [] })),
            });
          },
        }),
      }),
      ac: byAction({
        del: async (ctx) => {
          await ctx.answer({ message: deleteQuestion() });
        },
        del_ok: async (ctx) => {
          await account.deleteAccount(ctx.user.id);
          await states.clear(ctx.user.id);
          await ctx.answer({ message: { text: ACCOUNT_DELETED } });
        },
        del_no: async (ctx) => {
          await ctx.answer({ message: { text: ACCOUNT_KEPT } });
        },
      }),
    },
    location: async (ctx, point) => {
      await profile.setLocation(ctx.user.id, point);
      await ctx.reply({ text: LOCATION_UPDATED });
    },
  };
}
