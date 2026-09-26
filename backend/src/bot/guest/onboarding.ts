import { CONSENT_DOCUMENTS } from '../../domain/consents.ts';
import type { ConsentKind } from '../../domain/vocabulary.ts';
import type { OutgoingMessage } from '../../ports/messenger.ts';
import { answerStale, byAction } from '../callbacks.ts';
import type { BotContext, BotKit, BotModule } from '../context.ts';
import { describeFailure } from '../failures.ts';
import {
  agreeButtons,
  goalButtons,
  helpButtons,
  kcalButtons,
  menuButtons,
  offersButtons,
  onboardingLocationButtons,
  type Origin,
} from '../keyboards.ts';
import { consentRequest, helpMessage } from '../messages.ts';
import { formatStartLink, parseStartLink, type StartLink } from '../start-links.ts';
import { startFlow } from '../state.ts';
import {
  CONSENT_ACCEPTED,
  GOAL_QUESTION,
  GOAL_SKIPPED,
  goalChosen,
  GREETING,
  KCAL_INVALID,
  KCAL_PROMPT,
  kcalChosen,
  kcalQuestion,
  LOCATION_QUESTION,
  LOCATION_SAVED,
  LOCATION_SKIPPED,
  NOTICES,
  OFFERS_ACCEPTED,
  OFFERS_DECLINED,
  OFFERS_OFF,
  OFFERS_QUESTION,
  ONBOARDING_DONE,
  personalDataDocument,
  WELCOME_BACK,
} from '../texts.ts';
import { parseKcalTarget } from './meal-text.ts';
import { demoDiaryButtons } from './offer-keyboards.ts';
import { isGoal, parseKcalChoice, profileMessage, renderProfile } from './profile.ts';

function isOrigin(value: string | undefined): value is Origin {
  return value === 'ob' || value === 'pf';
}

function welcomeBack(): OutgoingMessage {
  return { text: WELCOME_BACK, buttons: menuButtons() };
}

export function createOnboardingModule(kit: BotKit): BotModule {
  const { services, logger } = kit;
  const { consents, profile } = services;

  const grant = (ctx: BotContext, kind: ConsentKind) =>
    consents.grant(ctx.user.id, kind, CONSENT_DOCUMENTS[kind].version, 'bot');

  async function askLocation(ctx: BotContext): Promise<void> {
    await ctx.saveState({ ...ctx.state, flow: startFlow({ name: 'onboarding_location' }, ctx.now) });
    await ctx.reply({ text: LOCATION_QUESTION, buttons: onboardingLocationButtons() });
  }

  async function finish(ctx: BotContext): Promise<void> {
    const sample = services.demo.enabled ? demoDiaryButtons() : [];
    await ctx.reply({ text: ONBOARDING_DONE, buttons: [...helpButtons(), ...sample] });
  }

  async function start(ctx: BotContext, args: string): Promise<void> {
    const link = parseStartLink(args);
    const { personalData } = await consents.status(ctx.user.id);
    if (personalData.granted) {
      if (!link) await ctx.reply(welcomeBack());
      else if (!(await kit.openStartLink(ctx, link))) await ctx.reply(helpMessage());
      return;
    }
    const pendingStart = link ? formatStartLink(link) : null;
    if (pendingStart !== null && pendingStart !== ctx.state.pendingStart) {
      await ctx.saveState({ ...ctx.state, pendingStart });
    }
    await ctx.reply({ text: GREETING });
    await ctx.reply(consentRequest());
  }

  async function openPending(ctx: BotContext, link: StartLink): Promise<void> {
    try {
      await kit.openStartLink(ctx, link);
    } catch (error) {
      const failure = describeFailure(error);
      if (failure.kind === 'unreachable') throw error;
      logger.warn({ err: error, userId: ctx.user.id }, 'start link after consent failed');
      await ctx.reply(failure.message);
    }
  }

  async function acceptPersonalData(ctx: BotContext): Promise<void> {
    const before = await consents.status(ctx.user.id);
    if (before.personalData.granted) {
      await ctx.answer({ notification: NOTICES.consentAlready });
      return;
    }
    await grant(ctx, 'personal_data');
    await ctx.answer({ message: { text: CONSENT_ACCEPTED } });
    const pending = parseStartLink(ctx.state.pendingStart);
    if (ctx.state.pendingStart !== null) await ctx.saveState({ ...ctx.state, pendingStart: null });
    if (pending) await openPending(ctx, pending);
    if (before.personalData.version !== null) {
      await ctx.reply(welcomeBack());
      return;
    }
    await ctx.reply({ text: OFFERS_QUESTION, buttons: offersButtons('ob') });
  }

  async function showDocument(ctx: BotContext): Promise<void> {
    const parts = personalDataDocument();
    for (const [index, text] of parts.entries()) {
      const message = index === parts.length - 1 ? { text, buttons: agreeButtons() } : { text };
      if (index === 0) await ctx.answer({ message });
      else await ctx.reply(message);
    }
  }

  async function answerOffers(ctx: BotContext, accepted: boolean, origin: string | undefined): Promise<void> {
    if (!isOrigin(origin)) {
      await answerStale(ctx);
      return;
    }
    if (accepted) await grant(ctx, 'personalized_offers');
    if (origin === 'pf') {
      await ctx.answer({ message: await profileMessage(profile, ctx.user.id) });
      return;
    }
    await ctx.answer({ message: { text: accepted ? OFFERS_ACCEPTED : OFFERS_DECLINED } });
    await ctx.reply({ text: GOAL_QUESTION, buttons: goalButtons('ob') });
  }

  async function chooseGoal(ctx: BotContext, [value]: string[]): Promise<void> {
    if (value === 'skip') {
      await ctx.answer({ message: { text: GOAL_SKIPPED } });
    } else if (isGoal(value)) {
      await profile.update(ctx.user.id, { goal: value });
      await ctx.answer({ message: { text: goalChosen(value) } });
    } else {
      await answerStale(ctx);
      return;
    }
    await ctx.reply({ text: kcalQuestion(true), buttons: kcalButtons('ob', ctx.miniAppEnabled) });
  }

  async function chooseTarget(ctx: BotContext, [value]: string[]): Promise<void> {
    if (value === 'custom') {
      await ctx.saveState({ ...ctx.state, flow: startFlow({ name: 'kcal_input', from: 'ob' }, ctx.now) });
      await ctx.answer({ message: { text: KCAL_PROMPT } });
      return;
    }
    const kcalTarget = parseKcalChoice(value);
    if (kcalTarget === null) {
      await answerStale(ctx);
      return;
    }
    await profile.update(ctx.user.id, { kcalTarget });
    await ctx.answer({ message: { text: kcalChosen(kcalTarget) } });
    await askLocation(ctx);
  }

  async function skipLocation(ctx: BotContext): Promise<void> {
    if (ctx.state.flow?.name === 'onboarding_location') await ctx.saveState({ ...ctx.state, flow: null });
    await ctx.answer({ message: { text: LOCATION_SKIPPED } });
    await finish(ctx);
  }

  return {
    commands: {
      start,
      help: async (ctx) => {
        await ctx.reply(helpMessage());
      },
    },
    callbacks: {
      cs: byAction({
        pd: byAction({ ok: acceptPersonalData, more: showDocument }),
        ad: byAction({
          yes: (ctx, [origin]) => answerOffers(ctx, true, origin),
          no: (ctx, [origin]) => answerOffers(ctx, false, origin),
          off: async (ctx) => {
            await consents.revoke(ctx.user.id, 'personalized_offers');
            await ctx.answer({ message: { text: OFFERS_OFF } });
          },
        }),
      }),
      ob: byAction({
        goal: chooseGoal,
        kcal: chooseTarget,
        loc: byAction({ skip: skipLocation }),
      }),
    },
    flows: {
      kcal_input: async (ctx, message) => {
        const flow = ctx.state.flow;
        if (flow?.name !== 'kcal_input' || message.text === null) return false;
        const kcalTarget = parseKcalTarget(message.text);
        if (kcalTarget === null) {
          await ctx.reply({ text: KCAL_INVALID });
          return true;
        }
        const updated = await profile.update(ctx.user.id, { kcalTarget });
        await ctx.saveState({ ...ctx.state, flow: null });
        if (flow.from === 'pf') {
          await ctx.reply(renderProfile(updated));
          return true;
        }
        await ctx.reply({ text: kcalChosen(kcalTarget) });
        await askLocation(ctx);
        return true;
      },
      onboarding_location: async (ctx, message) => {
        if (ctx.state.flow?.name !== 'onboarding_location' || !message.location) return false;
        await profile.setLocation(ctx.user.id, message.location);
        await ctx.saveState({ ...ctx.state, flow: null });
        await ctx.reply({ text: LOCATION_SAVED });
        await finish(ctx);
        return true;
      },
    },
  };
}
