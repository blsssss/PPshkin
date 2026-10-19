import type { Venue } from '../../domain/models.ts';
import {
  closeableRows,
  compactDate,
  parseCompactDate,
  unsoldPortions,
  type ReportData,
} from '../../domain/reports.ts';
import { escapeMarkdown } from '../../integrations/max/messenger.ts';
import type { Button, OutgoingMessage } from '../../ports/messenger.ts';
import { AppError } from '../../shared/errors.ts';
import { addDays, localDate } from '../../shared/time.ts';
import { answerStale, byAction, parseId } from '../callbacks.ts';
import type { BotContext, BotKit } from '../context.ts';
import { BUTTONS, NOTICES } from '../texts.ts';
import { homeRow, venueButton } from './keyboards.ts';
import { parseWriteOff } from './input.ts';
import { actorAt, clearFlow, knownFailure, saveFlow, venueCallback, venueFlow } from './owner.ts';
import {
  CLOSEOUT_CANCELLED,
  CLOSEOUT_INVALID,
  CLOSEOUT_PROMPT,
  dayCloseHeader,
  dayClosedText,
  DAY_REPORT_EMPTY,
  REPORT_FILE_SENT,
  REPORT_UNAVAILABLE,
  VENUE_BUTTONS,
  VENUE_ERROR_TEXTS,
  weekReportText,
} from './texts.ts';

const MAX_CLOSEOUT_ROWS = 8;
const WEEK_DAYS = 7;
const CLOSEOUT_FAILURES = [
  'deal_not_found',
  'deal_not_finished',
  'closeout_locked',
  'writeoff_too_large',
] as const;

type Choice = 'all' | '0' | 'n';
type Format = 'pdf' | 'csv';

function isChoice(value: string | undefined): value is Choice {
  return value === 'all' || value === '0' || value === 'n';
}

function venueAt(index: number) {
  return (args: string[]): number | undefined => parseId(args[index]) ?? undefined;
}

function closeoutRow(dealId: number, venueId: number, unsold: number): Button[] {
  return [
    venueButton(`Списали ${unsold}`, 'co', dealId, 'all', venueId),
    venueButton(VENUE_BUTTONS.closeoutNone, 'co', dealId, '0', venueId),
    venueButton(VENUE_BUTTONS.closeoutOther, 'co', dealId, 'n', venueId),
  ];
}

export function dayCloseScreen(venue: Venue, report: ReportData): OutgoingMessage {
  if (report.rows.length === 0) return { text: DAY_REPORT_EMPTY, buttons: [homeRow()] };
  const open = closeableRows(report.rows);
  if (open.length === 0) return { text: dayClosedText(report), format: 'markdown', buttons: [homeRow()] };
  const shown = open.slice(0, MAX_CLOSEOUT_ROWS);
  const rest = open.length - shown.length;
  return {
    text: [
      ...dayCloseHeader(venue.name, report),
      'Отметьте, сколько списали:',
      ...shown.map((row) => `${escapeMarkdown(row.itemName)}: не продано ${unsoldPortions(row)}`),
      ...(rest > 0 ? [`И ещё позиций: ${rest}, они появятся после этих`] : []),
    ].join('\n'),
    format: 'markdown',
    notify: true,
    buttons: [...shown.map((row) => closeoutRow(row.dealId, venue.id, unsoldPortions(row))), homeRow()],
  };
}

export function weekReportScreen(venue: Venue, report: ReportData, miniAppEnabled: boolean): OutgoingMessage {
  const week = compactDate(report.from);
  const app: Button[][] = miniAppEnabled
    ? [[{ kind: 'app', text: VENUE_BUTTONS.openReport, payload: `report_${week}` }]]
    : [];
  return {
    text: weekReportText(venue.name, report),
    format: 'markdown',
    notify: true,
    buttons: [...app, [venueButton(VENUE_BUTTONS.reportPdf, 'rp', 'pdf', week, venue.id)]],
  };
}

export function createReportScreens({ services }: BotKit) {
  const { companies, reports } = services;

  async function mark(
    ctx: BotContext,
    venue: Venue,
    dealId: number,
    writtenOff: number | 'rest',
  ): Promise<{ message: OutgoingMessage; failure: (typeof CLOSEOUT_FAILURES)[number] | null }> {
    try {
      const view = await reports.closeOut(actorAt(ctx, venue), dealId, writtenOff, 'bot');
      return {
        message: dayCloseScreen(venue, await reports.day(actorAt(ctx, venue), view.date)),
        failure: null,
      };
    } catch (error) {
      const failure = knownFailure(error, CLOSEOUT_FAILURES);
      return { message: { text: VENUE_ERROR_TEXTS[failure], buttons: [homeRow()] }, failure };
    }
  }

  const closeout = venueCallback(
    companies,
    'deal.edit',
    async (ctx, venue, [rawDeal, choice]) => {
      const dealId = parseId(rawDeal);
      if (dealId === null || !isChoice(choice)) {
        await answerStale(ctx);
        return;
      }
      if (choice === 'n') {
        await saveFlow(ctx, { name: 'closeout_input', dealId, venueId: venue.id });
        await ctx.answer({ notification: NOTICES.opening });
        await ctx.reply({ text: CLOSEOUT_PROMPT, buttons: [[venueButton(BUTTONS.cancel, 'rp', 'cancel')]] });
        return;
      }
      const { message } = await mark(ctx, venue, dealId, choice === 'all' ? 'rest' : 0);
      await ctx.answer({ message });
    },
    venueAt(2),
  );

  const onWriteOff = venueFlow(
    companies,
    'deal.edit',
    (flow, message) => flow.name === 'closeout_input' && (message.text !== null || message.photos.length > 0),
    async (ctx, venue, message) => {
      const flow = ctx.state.flow;
      if (flow?.name !== 'closeout_input' || flow.venueId !== venue.id) {
        await clearFlow(ctx, 'closeout_input');
        await ctx.reply({ text: CLOSEOUT_CANCELLED, buttons: [homeRow()] });
        return true;
      }
      const value = message.text === null ? null : parseWriteOff(message.text);
      if (value === null) {
        await ctx.reply({
          text: message.text === null ? CLOSEOUT_PROMPT : CLOSEOUT_INVALID,
          buttons: [[venueButton(BUTTONS.cancel, 'rp', 'cancel')]],
        });
        return true;
      }
      const { message: screen, failure } = await mark(ctx, venue, flow.dealId, value);
      if (failure === 'writeoff_too_large') {
        await ctx.reply({
          text: `${VENUE_ERROR_TEXTS.writeoff_too_large}. ${CLOSEOUT_PROMPT}`,
          buttons: [[venueButton(BUTTONS.cancel, 'rp', 'cancel')]],
        });
        return true;
      }
      await clearFlow(ctx, 'closeout_input');
      await ctx.reply(screen);
      return true;
    },
  );

  const day = venueCallback(companies, 'analytics.view', async (ctx, venue) => {
    const report = await reports.day(actorAt(ctx, venue), localDate(ctx.now, venue.timezone));
    await ctx.answer({ message: dayCloseScreen(venue, report) });
  });

  async function cancel(ctx: BotContext): Promise<void> {
    await clearFlow(ctx, 'closeout_input');
    await ctx.answer({ message: { text: CLOSEOUT_CANCELLED, buttons: [homeRow()] } });
  }

  const exportWeek = (format: Format) =>
    venueCallback(
      companies,
      'analytics.view',
      async (ctx, venue, [week]) => {
        const from = parseCompactDate(week ?? '');
        if (from === null) {
          await answerStale(ctx);
          return;
        }
        try {
          await reports.exportToChat(actorAt(ctx, venue), { from, to: addDays(from, WEEK_DAYS - 1) }, format);
          await ctx.answer({ notification: REPORT_FILE_SENT });
        } catch (error) {
          if (!(error instanceof AppError) || error.code !== 'messenger_unavailable') throw error;
          await ctx.answer({ notification: REPORT_UNAVAILABLE });
        }
      },
      venueAt(1),
    );

  return {
    closeout,
    onWriteOff,
    reports: byAction({
      day,
      cancel,
      pdf: exportWeek('pdf'),
      csv: exportWeek('csv'),
    }),
  };
}
