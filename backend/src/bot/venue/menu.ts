import type { MenuImport, MenuItem } from '../../domain/models.ts';
import { MAX_IMAGE_BYTES } from '../../http/uploads.ts';
import { DownloadTooLargeError, UserUnreachableError } from '../../integrations/max/errors.ts';
import { escapeMarkdown } from '../../integrations/max/messenger.ts';
import type { Sleep } from '../../integrations/max/sleep.ts';
import type { OutgoingMessage } from '../../ports/messenger.ts';
import type { BackgroundTasks } from '../../shared/background.ts';
import type { Clock } from '../../shared/clock.ts';
import { answerStale, parseId } from '../callbacks.ts';
import type { BotContext, BotKit } from '../context.ts';
import { link, miniAppUrl } from '../keyboards.ts';
import { BUTTONS, FIRST_PHOTO_ONLY, PHOTO_DOWNLOAD_FAILED } from '../texts.ts';
import { looksLikeMenu, MENU_TEXT_LIMIT } from './input.ts';
import { appRow, homeRow, newDealRow, uploadRow, venueButton } from './keyboards.ts';
import { clearFlow, knownFailure, ownerCallback, ownerFlow, saveFlow } from './owner.ts';
import {
  hasPrice,
  IMPORT_FAILED,
  IMPORT_TIMEOUT,
  importAppliedText,
  importReadyText,
  MENU_EMPTY,
  MENU_PHOTO_TOO_LARGE,
  MENU_TEXT_TOO_LONG,
  MENU_TEXT_WITHOUT_PRICES,
  menuText,
  NO_PRICES,
  RECOGNIZING_PHOTO,
  RECOGNIZING_TEXT,
  UPLOAD_CANCELLED,
  UPLOAD_PROMPT,
  VENUE_BUTTONS,
  VENUE_ERROR_TEXTS,
} from './texts.ts';

export interface ImportWaiting {
  clock: Clock;
  background: BackgroundTasks;
  sleep: Sleep;
}

interface Audience {
  ownerId: number;
  botUsername: string;
  miniAppEnabled: boolean;
}

const IMPORT_POLL_INTERVAL_MS = 3000;
const IMPORT_WAIT_LIMIT_MS = 3 * 60_000;

const START_FAILURES = ['import_in_progress', 'import_limit_reached'] as const;
const APPLY_FAILURES = ['import_already_applied', 'import_not_ready', 'import_not_found'] as const;

function menuRow() {
  return [venueButton(VENUE_BUTTONS.menu, 'menu')];
}

function uploadPrompt(text: string): OutgoingMessage {
  return { text, buttons: [[venueButton(BUTTONS.cancel, 'menu', 'cancel')]] };
}

function menuScreen(items: readonly MenuItem[], miniAppEnabled: boolean): OutgoingMessage {
  if (items.length === 0) return { text: MENU_EMPTY, buttons: [uploadRow(), homeRow()] };
  return {
    text: menuText(items),
    buttons: [
      [...uploadRow(), venueButton(VENUE_BUTTONS.deals, 'deals')],
      ...appRow(miniAppEnabled),
      homeRow(),
    ],
  };
}

function importScreen(found: MenuImport, audience: Omit<Audience, 'ownerId'>): OutgoingMessage {
  switch (found.status) {
    case 'ready':
      return {
        text: importReadyText(found.items),
        buttons: [
          [venueButton(VENUE_BUTTONS.applyAll, 'imp', 'apply', found.id)],
          ...(audience.miniAppEnabled
            ? [[link(VENUE_BUTTONS.openImport, miniAppUrl(audience.botUsername, `import_${found.id}`))]]
            : []),
          uploadRow(VENUE_BUTTONS.uploadAgain),
        ],
      };
    case 'failed':
      return {
        text: escapeMarkdown(found.error ?? IMPORT_FAILED),
        buttons: [uploadRow(VENUE_BUTTONS.retry)],
      };
    case 'applied':
      return { text: VENUE_ERROR_TEXTS.import_already_applied, buttons: [menuRow()] };
    case 'processing':
      return { text: VENUE_ERROR_TEXTS.import_not_ready };
  }
}

export function createMenuScreens({ services, messenger, logger }: BotKit, waiting: ImportWaiting) {
  const { venues, menu, menuImports } = services;
  const { clock, background, sleep } = waiting;

  async function deliver(ownerId: number, message: OutgoingMessage): Promise<void> {
    try {
      await messenger.sendToUser(ownerId, message);
    } catch (error) {
      if (!(error instanceof UserUnreachableError)) throw error;
      logger.warn({ userId: ownerId }, 'venue owner cannot be reached, the bot is probably blocked');
    }
  }

  async function check(ownerId: number, importId: number): Promise<MenuImport | null> {
    try {
      return await menuImports.get(ownerId, importId);
    } catch (error) {
      logger.warn({ err: error, userId: ownerId, importId }, 'menu import status check failed');
      return null;
    }
  }

  async function waitForImport({ ownerId, ...audience }: Audience, importId: number): Promise<void> {
    const deadline = clock.now().getTime() + IMPORT_WAIT_LIMIT_MS;
    while (clock.now().getTime() < deadline) {
      const slept = await sleep(IMPORT_POLL_INTERVAL_MS).then(
        () => true,
        () => false,
      );
      if (!slept) return;
      const found = await check(ownerId, importId);
      if (found && found.status !== 'processing') {
        await deliver(ownerId, importScreen(found, audience));
        return;
      }
    }
    await deliver(ownerId, {
      text: IMPORT_TIMEOUT,
      buttons: [uploadRow(VENUE_BUTTONS.retry), ...appRow(audience.miniAppEnabled)],
    });
  }

  async function start(ctx: BotContext, run: () => Promise<MenuImport>, started: string): Promise<void> {
    let created: MenuImport;
    try {
      created = await run();
    } catch (error) {
      const failure = knownFailure(error, START_FAILURES);
      await clearFlow(ctx, 'menu_upload');
      await ctx.reply({ text: VENUE_ERROR_TEXTS[failure], buttons: appRow(ctx.miniAppEnabled) });
      return;
    }
    await clearFlow(ctx, 'menu_upload');
    await ctx.reply({ text: started });
    const audience = {
      ownerId: ctx.user.id,
      botUsername: ctx.botUsername,
      miniAppEnabled: ctx.miniAppEnabled,
    };
    background.run(`menu-import-${created.id}-wait`, () => waitForImport(audience, created.id));
  }

  async function download(ctx: BotContext, url: string): Promise<Buffer | null> {
    let image: Buffer;
    try {
      image = await messenger.downloadFile(url);
    } catch (error) {
      const tooLarge = error instanceof DownloadTooLargeError;
      if (!tooLarge) logger.warn({ err: error, userId: ctx.user.id }, 'menu photo download failed');
      await ctx.reply(uploadPrompt(tooLarge ? MENU_PHOTO_TOO_LARGE : PHOTO_DOWNLOAD_FAILED));
      return null;
    }
    if (image.length <= MAX_IMAGE_BYTES) return image;
    await ctx.reply(uploadPrompt(MENU_PHOTO_TOO_LARGE));
    return null;
  }

  async function importPhoto(ctx: BotContext, url: string, several: boolean): Promise<void> {
    if (ctx.chatId !== null) await messenger.sendTyping(ctx.chatId);
    const image = await download(ctx, url);
    if (!image) return;
    const started = several ? `${FIRST_PHOTO_ONLY}\n${RECOGNIZING_PHOTO}` : RECOGNIZING_PHOTO;
    await start(ctx, () => menuImports.fromPhoto(ctx.user.id, image), started);
  }

  async function importText(ctx: BotContext, text: string): Promise<void> {
    if (text.length > MENU_TEXT_LIMIT) await ctx.reply(uploadPrompt(MENU_TEXT_TOO_LONG));
    else if (!looksLikeMenu(text)) await ctx.reply(uploadPrompt(MENU_TEXT_WITHOUT_PRICES));
    else await start(ctx, () => menuImports.fromText(ctx.user.id, text), RECOGNIZING_TEXT);
  }

  const show = ownerCallback(venues, async (ctx) => {
    await ctx.answer({ message: menuScreen(await menu.list(ctx.user.id), ctx.miniAppEnabled) });
  });

  const upload = ownerCallback(venues, async (ctx) => {
    await saveFlow(ctx, { name: 'menu_upload' });
    await ctx.answer({ message: uploadPrompt(UPLOAD_PROMPT) });
  });

  async function cancelUpload(ctx: BotContext): Promise<void> {
    await clearFlow(ctx, 'menu_upload');
    await ctx.answer({ message: { text: UPLOAD_CANCELLED, buttons: [menuRow()] } });
  }

  const apply = ownerCallback(venues, async (ctx, _venue, [value]) => {
    const importId = parseId(value);
    if (importId === null) {
      await answerStale(ctx);
      return;
    }
    let found: MenuImport;
    try {
      found = await menuImports.get(ctx.user.id, importId);
    } catch (error) {
      knownFailure(error, ['import_not_found']);
      await ctx.answer({ message: { text: VENUE_ERROR_TEXTS.import_not_found, buttons: [uploadRow()] } });
      return;
    }
    if (found.status !== 'ready') {
      await ctx.answer({ message: importScreen(found, ctx) });
      return;
    }
    await ctx.answer({ message: { text: importReadyText(found.items) } });
    const priced = found.items.filter(hasPrice);
    if (priced.length === 0) {
      await ctx.reply({ text: NO_PRICES, buttons: [uploadRow(VENUE_BUTTONS.uploadAgain)] });
      return;
    }
    let added: MenuItem[];
    try {
      added = await menuImports.apply(ctx.user.id, importId, priced);
    } catch (error) {
      const failure = knownFailure(error, APPLY_FAILURES);
      await ctx.reply({ text: VENUE_ERROR_TEXTS[failure], buttons: [menuRow()] });
      return;
    }
    const skipped = found.items.filter((item) => !hasPrice(item)).map((item) => item.name);
    await ctx.reply({
      text: importAppliedText(added.length, skipped),
      buttons: [[...menuRow(), ...newDealRow(VENUE_BUTTONS.publishDeal)]],
    });
  });

  const onUpload = ownerFlow(
    venues,
    (flow, message) => flow.name === 'menu_upload' && (message.photos.length > 0 || message.text !== null),
    async (ctx, _venue, message) => {
      const [photo] = message.photos;
      if (photo) await importPhoto(ctx, photo.url, message.photos.length > 1);
      else if (message.text !== null) await importText(ctx, message.text);
      return true;
    },
  );

  return {
    show,
    upload,
    cancelUpload,
    apply,
    onUpload,
  };
}
