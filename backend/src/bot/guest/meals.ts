import type { Macros } from '../../domain/models.ts';
import { DownloadTooLargeError } from '../../integrations/max/errors.ts';
import type { Button, OutgoingMessage } from '../../ports/messenger.ts';
import type { UnavailableReason } from '../../ports/recognition.ts';
import type { DiaryDay, DiaryMeal, ManualMealInput, MealLogResult } from '../../services/diary.ts';
import { formatLocalTime } from '../../shared/time.ts';
import { answerStale, byAction, parseId, payload } from '../callbacks.ts';
import type { BotContext, BotKit, BotModule, MessageInput } from '../context.ts';
import { callback, eatButton, openApp } from '../keyboards.ts';
import { helpMessage } from '../messages.ts';
import { createQuota } from '../quota.ts';
import { startFlow, type MealCandidate } from '../state.ts';
import {
  bold,
  BUTTONS,
  confirmText,
  COUNTING,
  countingFor,
  dayProgress,
  FIRST_PHOTO_ONLY,
  FIX_INVALID,
  FIX_PROMPT,
  FIXED_HEADER,
  INPUT_CANCELLED,
  kcalRange,
  limitedLines,
  loggedHeader,
  localDateLabel,
  LOOKING_AT_PHOTO,
  macros,
  MANUAL_INVALID,
  MANUAL_PROMPT,
  MEAL_DELETED,
  MEAL_RECORDED,
  NOT_FOOD_PHOTO,
  NOT_FOOD_TEXT,
  NOTICES,
  PHOTO_DOWNLOAD_FAILED,
  PHOTO_RECOGNITION_OFF,
  PHOTO_TOO_LARGE,
  RATE_LIMITED,
  RECOGNITION_FAILED,
  RECORD_FORMS,
  TEXT_RECOGNITION_OFF,
  TITLE_IN_BUTTON_LIMIT,
  TITLE_IN_LIST_LIMIT,
  todayEmpty,
  todayTitle,
  todayTotal,
  truncate,
  UNCERTAIN,
  UNSUPPORTED_IMAGE,
} from '../texts.ts';
import { classifyText, parseFixInput, parseManualEntry } from './meal-text.ts';
import { createMealSuggestion } from './offers.ts';

type RecognitionSource = 'photo' | 'text';

const RECOGNITIONS_PER_HOUR = 20;
const HOUR_MS = 3_600_000;
const TODAY_LIMIT = 20;
const DISHES_LIMIT = 5;
const MULTI_DISH_ORIGIN = 'm';
const TODAY_ORIGIN = 't';
const FIXED_ORIGIN = 'f';
const ID_SEPARATOR = '.';
const CANDIDATE_INDEX = /^[0-9]$/;
const DIGIT = /\d/;

function mealLine(meal: Pick<DiaryMeal, 'title' | 'kcalMin' | 'kcalMax'>): string {
  return `${bold(truncate(meal.title, TITLE_IN_LIST_LIMIT))}, ${kcalRange(meal.kcalMin, meal.kcalMax)}`;
}

function combinedMacros(meals: readonly Macros[]): Macros {
  const total = (field: keyof Macros) =>
    meals.some((meal) => meal[field] !== null)
      ? meals.reduce((sum, meal) => sum + (meal[field] ?? 0), 0)
      : null;
  return { proteinG: total('proteinG'), fatG: total('fatG'), carbsG: total('carbsG') };
}

function mealsText(meals: readonly DiaryMeal[], day: DiaryDay, fixed = false): string {
  const [first] = meals;
  const header =
    meals.length === 1 && first
      ? [`${fixed ? FIXED_HEADER : loggedHeader(1)} ${mealLine(first)}`]
      : [loggedHeader(meals.length), ...meals.map(mealLine)];
  const nutrients = macros(combinedMacros(meals));
  return [
    ...header,
    ...(nutrients ? [nutrients] : []),
    dayProgress(day.totals.kcal, day.targetKcal, day.remainingKcal),
  ].join('\n');
}

function manualButton(): Button[] {
  return [callback(BUTTONS.manual, payload('ml', 'manual'))];
}

function withManualEntry(text: string): OutgoingMessage {
  return { text, buttons: [manualButton()] };
}

function withCancel(text: string, ...input: readonly (string | number)[]): OutgoingMessage {
  return { text, buttons: [[callback(BUTTONS.cancel, payload('ml', 'cancel', ...input))]] };
}

function mealButtons(meals: readonly DiaryMeal[], fixed: boolean): Button[][] {
  const ids = meals.map((meal) => meal.id).join(ID_SEPARATOR);
  const confirm = payload('ml', 'ok', ids, ...(fixed ? [FIXED_ORIGIN] : []));
  const [first] = meals;
  if (meals.length === 1 && first) {
    return [
      [
        callback(BUTTONS.correct, confirm),
        callback(BUTTONS.fix, payload('ml', 'fix', first.id)),
        callback(BUTTONS.remove, payload('ml', 'del', first.id)),
      ],
    ];
  }
  return [
    ...meals.map((meal) => {
      const title = truncate(meal.title, TITLE_IN_BUTTON_LIMIT);
      return [
        callback(`${BUTTONS.fix}: ${title}`, payload('ml', 'fix', meal.id)),
        callback(`${BUTTONS.remove}: ${title}`, payload('ml', 'del', meal.id, MULTI_DISH_ORIGIN)),
      ];
    }),
    [callback(BUTTONS.allCorrect, confirm)],
  ];
}

function mealsMessage(meals: readonly DiaryMeal[], day: DiaryDay, fixed = false): OutgoingMessage {
  return { text: mealsText(meals, day, fixed), buttons: mealButtons(meals, fixed) };
}

function uncertainMessage(candidates: readonly MealCandidate[]): OutgoingMessage {
  return {
    text: UNCERTAIN,
    buttons: [
      ...candidates.map((candidate, index) => [
        callback(
          `${truncate(candidate.title, TITLE_IN_BUTTON_LIMIT)}, ${kcalRange(candidate.kcalMin, candidate.kcalMax)}`,
          payload('ml', 'pick', index),
        ),
      ]),
      manualButton(),
    ],
  };
}

function unavailableText(reason: UnavailableReason, source: RecognitionSource): string {
  if (reason === 'disabled') return source === 'photo' ? PHOTO_RECOGNITION_OFF : TEXT_RECOGNITION_OFF;
  return reason === 'unsupported_image' ? UNSUPPORTED_IMAGE : RECOGNITION_FAILED;
}

function resultMessage(result: MealLogResult, source: RecognitionSource): OutgoingMessage {
  switch (result.status) {
    case 'logged':
      return mealsMessage(result.meals, result.day);
    case 'uncertain':
      return uncertainMessage(result.candidates.slice(0, DISHES_LIMIT));
    case 'not_food':
      return withManualEntry(source === 'photo' ? NOT_FOOD_PHOTO : NOT_FOOD_TEXT);
    case 'unavailable':
      return withManualEntry(unavailableText(result.reason, source));
  }
}

function todayMessage(day: DiaryDay, miniAppEnabled: boolean): OutgoingMessage {
  const title = todayTitle(localDateLabel(day.date));
  const appRow = miniAppEnabled ? [[openApp(BUTTONS.openDiary)]] : [];
  const latest = day.meals.reduce<DiaryMeal | null>(
    (last, meal) => (last === null || meal.createdAt >= last.createdAt ? meal : last),
    null,
  );
  if (latest === null) {
    return { text: `${title}\n${todayEmpty(day.targetKcal)}`, buttons: [[eatButton()], ...appRow] };
  }
  const lines = limitedLines(
    day.meals.map((meal) => `${formatLocalTime(meal.eatenAt, day.timezone)} ${mealLine(meal)}`),
    TODAY_LIMIT,
    RECORD_FORMS,
  );
  const nutrients = macros(combinedMacros(day.meals));
  return {
    text: [
      title,
      ...lines,
      '',
      todayTotal(day.totals.kcal, day.targetKcal, day.remainingKcal),
      ...(nutrients ? [nutrients] : []),
    ].join('\n'),
    buttons: [
      [eatButton()],
      [callback(BUTTONS.removeLast, payload('ml', 'del', latest.id, TODAY_ORIGIN))],
      ...appRow,
    ],
  };
}

function parseIds(value: string | undefined): number[] | null {
  const ids = (value ?? '').split(ID_SEPARATOR).map(parseId);
  if (ids.length > DISHES_LIMIT || ids.some((id) => id === null)) return null;
  return ids.filter((id) => id !== null);
}

function candidateInput(candidate: MealCandidate): ManualMealInput {
  const { title, kcalMin, kcalMax, proteinG, fatG, carbsG, tags } = candidate;
  return { title, kcalMin, kcalMax, proteinG, fatG, carbsG, tags };
}

async function cancelInput(ctx: BotContext, pending: boolean): Promise<void> {
  if (pending) await ctx.saveState({ ...ctx.state, flow: null });
  await ctx.answer({ message: { text: INPUT_CANCELLED } });
}

async function rejectInput(ctx: BotContext, text: string, hint: OutgoingMessage): Promise<boolean> {
  if (!DIGIT.test(text)) {
    await ctx.saveState({ ...ctx.state, flow: null });
    return false;
  }
  await ctx.reply(hint);
  return true;
}

export function createMealsModule(kit: BotKit): BotModule {
  const { services, messenger, logger } = kit;
  const { diary } = services;
  const quota = createQuota({ limit: RECOGNITIONS_PER_HOUR, windowMs: HOUR_MS });
  const suggestOffer = createMealSuggestion(kit);

  async function logManual(ctx: BotContext, input: ManualMealInput): Promise<OutgoingMessage> {
    const meal = await diary.addManual(ctx.user.id, input);
    return mealsMessage([meal], await diary.day(ctx.user.id));
  }

  async function recognize(
    ctx: BotContext,
    source: RecognitionSource,
    run: () => Promise<MealLogResult>,
  ): Promise<void> {
    const result = await run();
    const sent = await ctx.settle(resultMessage(result, source));
    if (result.status === 'logged') await suggestOffer(ctx);
    const candidates = result.status === 'uncertain' ? result.candidates.slice(0, DISHES_LIMIT) : [];
    if (candidates.length === 0) return;
    await ctx.saveState({
      ...ctx.state,
      flow: startFlow({ name: 'meal_candidates', candidates, messageId: sent.messageId }, ctx.now),
    });
  }

  async function download(ctx: BotContext, url: string): Promise<Buffer | null> {
    try {
      return await messenger.downloadFile(url);
    } catch (error) {
      const tooLarge = error instanceof DownloadTooLargeError;
      if (!tooLarge) logger.warn({ err: error, userId: ctx.user.id }, 'food photo download failed');
      await ctx.settle(withManualEntry(tooLarge ? PHOTO_TOO_LARGE : PHOTO_DOWNLOAD_FAILED));
      return null;
    }
  }

  async function logPhoto(ctx: BotContext, message: MessageInput): Promise<void> {
    const [photo] = message.photos;
    if (!photo) return;
    if (!quota.take(ctx.user.id, ctx.now)) {
      await ctx.reply(withManualEntry(RATE_LIMITED));
      return;
    }
    if (ctx.chatId !== null) await messenger.sendTyping(ctx.chatId);
    await ctx.placeholder(
      message.photos.length > 1 ? `${FIRST_PHOTO_ONLY}\n${LOOKING_AT_PHOTO}` : LOOKING_AT_PHOTO,
    );
    const image = await download(ctx, photo.url);
    if (image) await recognize(ctx, 'photo', () => diary.logFromPhoto(ctx.user.id, image));
  }

  async function logText(ctx: BotContext, text: string): Promise<void> {
    if (!quota.take(ctx.user.id, ctx.now)) {
      await ctx.reply(withManualEntry(RATE_LIMITED));
      return;
    }
    await ctx.placeholder(COUNTING);
    await recognize(ctx, 'text', () => diary.logFromText(ctx.user.id, text));
  }

  async function onText(ctx: BotContext, text: string): Promise<void> {
    const intent = classifyText(text);
    switch (intent.kind) {
      case 'manual':
        await ctx.reply(await logManual(ctx, intent.entry));
        await suggestOffer(ctx);
        return;
      case 'recognize':
        await logText(ctx, text);
        return;
      case 'help':
        await ctx.reply(helpMessage());
        return;
      case 'confirm': {
        const sent = await ctx.reply({
          text: confirmText(text),
          buttons: [
            [
              callback(BUTTONS.yes, payload('ml', 'text', 'yes')),
              callback(BUTTONS.no, payload('ml', 'text', 'no')),
            ],
          ],
        });
        await ctx.saveState({
          ...ctx.state,
          flow: startFlow({ name: 'meal_text_confirm', text, messageId: sent.messageId }, ctx.now),
        });
      }
    }
  }

  async function confirmLogged(ctx: BotContext, [value, origin]: string[]): Promise<void> {
    const ids = parseIds(value);
    if (!ids) {
      await answerStale(ctx);
      return;
    }
    const day = await diary.day(ctx.user.id);
    const meals = day.meals.filter((meal) => ids.includes(meal.id));
    const text = meals.length === 0 ? MEAL_RECORDED : mealsText(meals, day, origin === FIXED_ORIGIN);
    await ctx.answer({ message: { text } });
  }

  async function startFix(ctx: BotContext, [value]: string[]): Promise<void> {
    const mealId = parseId(value);
    if (mealId === null) {
      await answerStale(ctx);
      return;
    }
    await ctx.saveState({ ...ctx.state, flow: startFlow({ name: 'meal_fix', mealId }, ctx.now) });
    await ctx.answer({ notification: NOTICES.fixWaiting });
    await ctx.reply(withCancel(FIX_PROMPT, 'fix', mealId));
  }

  async function cancelFix(ctx: BotContext, [value]: string[]): Promise<void> {
    const mealId = parseId(value);
    if (mealId === null) {
      await answerStale(ctx);
      return;
    }
    const flow = ctx.state.flow;
    await cancelInput(ctx, flow?.name === 'meal_fix' && flow.mealId === mealId);
  }

  async function cancelManual(ctx: BotContext): Promise<void> {
    await cancelInput(ctx, ctx.state.flow?.name === 'meal_manual');
  }

  async function removeMeal(ctx: BotContext, [value, origin]: string[]): Promise<void> {
    const mealId = parseId(value);
    if (mealId === null) {
      await answerStale(ctx);
      return;
    }
    await diary.remove(ctx.user.id, mealId);
    const flow = ctx.state.flow;
    if (flow?.name === 'meal_fix' && flow.mealId === mealId)
      await ctx.saveState({ ...ctx.state, flow: null });
    if (origin === TODAY_ORIGIN) {
      await ctx.answer({ message: todayMessage(await diary.day(ctx.user.id), ctx.miniAppEnabled) });
    } else if (origin === MULTI_DISH_ORIGIN) {
      await ctx.answer({ notification: NOTICES.mealDeleted });
    } else {
      await ctx.answer({ message: { text: MEAL_DELETED } });
    }
  }

  async function pickCandidate(ctx: BotContext, [value = '']: string[]): Promise<void> {
    const flow = ctx.state.flow;
    const pressedCurrent = flow?.name === 'meal_candidates' && flow.messageId === ctx.callbackMessageId;
    const candidate =
      pressedCurrent && CANDIDATE_INDEX.test(value) ? flow.candidates[Number(value)] : undefined;
    if (!candidate) {
      await answerStale(ctx);
      return;
    }
    const message = await logManual(ctx, candidateInput(candidate));
    await ctx.saveState({ ...ctx.state, flow: null });
    await ctx.answer({ message });
    await suggestOffer(ctx);
  }

  async function startManual(ctx: BotContext): Promise<void> {
    await ctx.saveState({ ...ctx.state, flow: startFlow({ name: 'meal_manual' }, ctx.now) });
    await ctx.answer({ message: withCancel(MANUAL_PROMPT, 'manual') });
  }

  async function acceptText(ctx: BotContext): Promise<void> {
    const flow = ctx.state.flow;
    if (flow?.name !== 'meal_text_confirm' || flow.messageId !== ctx.callbackMessageId) {
      await answerStale(ctx);
      return;
    }
    await ctx.saveState({ ...ctx.state, flow: null });
    if (!quota.take(ctx.user.id, ctx.now)) {
      await ctx.answer({ message: withManualEntry(RATE_LIMITED) });
      return;
    }
    await ctx.placeholder(countingFor(flow.text));
    await recognize(ctx, 'text', () => diary.logFromText(ctx.user.id, flow.text));
  }

  async function declineText(ctx: BotContext): Promise<void> {
    const flow = ctx.state.flow;
    if (flow?.name === 'meal_text_confirm' && flow.messageId === ctx.callbackMessageId) {
      await ctx.saveState({ ...ctx.state, flow: null });
    }
    await ctx.answer({ message: helpMessage() });
  }

  return {
    commands: {
      today: async (ctx) => {
        await ctx.reply(todayMessage(await diary.day(ctx.user.id), ctx.miniAppEnabled));
      },
    },
    callbacks: {
      ml: byAction({
        ok: confirmLogged,
        fix: startFix,
        del: removeMeal,
        pick: pickCandidate,
        manual: startManual,
        cancel: byAction({ fix: cancelFix, manual: cancelManual }),
        text: byAction({ yes: acceptText, no: declineText }),
      }),
    },
    flows: {
      meal_fix: async (ctx, message) => {
        const flow = ctx.state.flow;
        if (flow?.name !== 'meal_fix' || message.text === null) return false;
        const input = parseFixInput(message.text);
        if (!input) return rejectInput(ctx, message.text, withCancel(FIX_INVALID, 'fix', flow.mealId));
        await ctx.saveState({ ...ctx.state, flow: null });
        const meal = await diary.update(ctx.user.id, flow.mealId, input);
        await ctx.reply(mealsMessage([meal], await diary.day(ctx.user.id), true));
        return true;
      },
      meal_manual: async (ctx, message) => {
        if (ctx.state.flow?.name !== 'meal_manual' || message.text === null) return false;
        const entry = parseManualEntry(message.text);
        if (!entry) return rejectInput(ctx, message.text, withCancel(MANUAL_INVALID, 'manual'));
        await ctx.saveState({ ...ctx.state, flow: null });
        await ctx.reply(await logManual(ctx, entry));
        await suggestOffer(ctx);
        return true;
      },
    },
    photos: logPhoto,
    text: onText,
  };
}
