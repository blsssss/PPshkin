import {
  BLOCK_REASON_LIMIT,
  COMPANY_NOTE_LIMIT,
  COMPANY_REJECTION_OTHER,
  COMPANY_REJECTION_REASONS,
  COMPLAINT_REASON_TEXTS,
  type AdminComplaint,
} from '../../domain/moderation.ts';
import type { OutgoingMessage } from '../../ports/messenger.ts';
import { formatLocalTime } from '../../shared/time.ts';
import { answerStale, byAction, parseId, payload } from '../callbacks.ts';
import type { BotContext, BotKit, BotModule, MessageInput } from '../context.ts';
import { describeFailure } from '../failures.ts';
import { callback } from '../keyboards.ts';
import { helpMessage } from '../messages.ts';
import { startFlow } from '../state.ts';
import { bold } from '../texts.ts';

const ADMIN_BUTTONS = {
  complaints: 'Жалобы',
  resolved: 'Решено',
  rejected: 'Отклонить',
  blockVenue: 'Заблокировать заведение',
  cancel: 'Отмена',
} as const;

const ADMIN_TEXTS = {
  home: 'Администратор',
  noComplaints: 'Открытых жалоб нет.',
  askReason: `Напишите причину блокировки заведения, до ${String(BLOCK_REASON_LIMIT)} символов. Её увидит владелец.`,
  tooLong: `Причина длиннее ${String(BLOCK_REASON_LIMIT)} символов, сократите её.`,
  cancelled: 'Блокировка отменена.',
  blocked: 'Заведение заблокировано: оно скрыто от гостей, брони отменены, владелец получил причину.',
  verified: 'Компания подтверждена, владельцы получили сообщение.',
  rejected: 'Компания отклонена, владельцы получили причину.',
  pickReason: 'Выберите причину отказа.',
  askNote: `Напишите причину отказа, до ${String(COMPANY_NOTE_LIMIT)} символов. Её увидят владельцы компании.`,
  noteTooLong: `Причина длиннее ${String(COMPANY_NOTE_LIMIT)} символов, сократите её.`,
  rejectCancelled: 'Отказ отменён.',
} as const;

const COMPLAINTS_PAGE = 5;

function complaintCard(complaint: AdminComplaint, timezone: string): OutgoingMessage {
  return {
    text: [
      bold(`Жалоба №${complaint.id}`),
      `Заведение: ${complaint.venueName}`,
      ...(complaint.bookingCode === null
        ? []
        : [`Бронь ${complaint.bookingCode}: ${complaint.itemName ?? ''}`]),
      `Причина: ${COMPLAINT_REASON_TEXTS[complaint.reason]}`,
      ...(complaint.text === null ? [] : [complaint.text]),
      formatLocalTime(complaint.createdAt, timezone),
    ].join('\n'),
    buttons: [
      [
        callback(ADMIN_BUTTONS.resolved, payload('ad', 'ok', complaint.id)),
        callback(ADMIN_BUTTONS.rejected, payload('ad', 'no', complaint.id)),
      ],
      [callback(ADMIN_BUTTONS.blockVenue, payload('ad', 'bv', complaint.venueId))],
    ],
  };
}

export function createAdminModule({ services }: BotKit): BotModule {
  const { moderation } = services;

  async function guarded(
    ctx: BotContext,
    run: () => Promise<void>,
    otherwise: () => Promise<void>,
  ): Promise<void> {
    if (!moderation.isAdmin(ctx.user.id)) {
      await otherwise();
      return;
    }
    try {
      await run();
    } catch (error) {
      const failure = describeFailure(error);
      if (failure.kind !== 'known') throw error;
      await ctx.reply(failure.message);
    }
  }

  function decideCompany(ctx: BotContext, id: number, decision: 'verified' | 'rejected', note?: string) {
    return guard(ctx, async () => {
      await moderation.decideCompanyVerification(ctx.user.id, id, { decision, note }, 'bot');
      await ctx.saveState({ ...ctx.state, flow: null });
      await ctx.answer({
        message: { text: decision === 'verified' ? ADMIN_TEXTS.verified : ADMIN_TEXTS.rejected },
      });
    });
  }

  function verifyCompany(ctx: BotContext, [value]: string[]): Promise<void> {
    const id = parseId(value);
    return id === null ? answerStale(ctx) : decideCompany(ctx, id, 'verified');
  }

  function askRejection(ctx: BotContext, [value]: string[]): Promise<void> {
    return guard(ctx, async () => {
      const id = parseId(value);
      if (id === null) {
        await answerStale(ctx);
        return;
      }
      await ctx.answer({
        message: {
          text: ADMIN_TEXTS.pickReason,
          buttons: [
            ...COMPANY_REJECTION_REASONS.map((reason, index) => [
              callback(reason, payload('ad', 'rr', id, index)),
            ]),
            [callback(COMPANY_REJECTION_OTHER, payload('ad', 'ro', id))],
          ],
        },
      });
    });
  }

  function rejectWithReason(ctx: BotContext, [value, index]: string[]): Promise<void> {
    const id = parseId(value);
    const reason = COMPANY_REJECTION_REASONS[Number(index)];
    return id === null || reason === undefined
      ? answerStale(ctx)
      : decideCompany(ctx, id, 'rejected', reason);
  }

  function askOtherReason(ctx: BotContext, [value]: string[]): Promise<void> {
    return guard(ctx, async () => {
      const companyId = parseId(value);
      if (companyId === null) {
        await answerStale(ctx);
        return;
      }
      await ctx.saveState({
        ...ctx.state,
        flow: startFlow({ name: 'admin_reject', companyId }, ctx.now),
      });
      await ctx.answer({
        message: {
          text: ADMIN_TEXTS.askNote,
          buttons: [[callback(ADMIN_BUTTONS.cancel, payload('ad', 'rc'))]],
        },
      });
    });
  }

  function cancelRejection(ctx: BotContext): Promise<void> {
    return guard(ctx, async () => {
      await ctx.saveState({ ...ctx.state, flow: null });
      await ctx.answer({ message: { text: ADMIN_TEXTS.rejectCancelled } });
    });
  }

  function ownerInvite(ctx: BotContext, [value]: string[]): Promise<void> {
    return guard(ctx, async () => {
      const id = parseId(value);
      if (id === null) {
        await answerStale(ctx);
        return;
      }
      const created = await moderation.createOwnerInviteAsAdmin(ctx.user.id, id, 'bot');
      await ctx.answer({
        message: {
          text: `Приглашение владельца действует 72 часа и принимается один раз. Передайте ссылку заведению: ${created.botLink}`,
        },
      });
    });
  }

  const guard = (ctx: BotContext, run: () => Promise<void>) => guarded(ctx, run, () => answerStale(ctx));

  async function home(ctx: BotContext): Promise<void> {
    await guarded(
      ctx,
      async () => {
        await ctx.reply({
          text: ADMIN_TEXTS.home,
          buttons: [[callback(ADMIN_BUTTONS.complaints, payload('ad', 'cl'))]],
        });
      },
      async () => {
        await ctx.reply(helpMessage());
      },
    );
  }

  function list(ctx: BotContext): Promise<void> {
    return guard(ctx, async () => {
      const open = (await moderation.listForReview(ctx.user.id, 'open')).slice(0, COMPLAINTS_PAGE);
      if (open.length === 0) {
        await ctx.answer({ message: { text: ADMIN_TEXTS.noComplaints } });
        return;
      }
      await ctx.answer({ notification: `Жалоб: ${String(open.length)}` });
      for (const complaint of open) await ctx.reply(complaintCard(complaint, ctx.user.timezone));
    });
  }

  function decide(status: 'resolved' | 'rejected') {
    return (ctx: BotContext, [value]: string[]): Promise<void> =>
      guard(ctx, async () => {
        const id = parseId(value);
        if (id === null) {
          await answerStale(ctx);
          return;
        }
        const complaint = await moderation.resolveComplaint(ctx.user.id, id, { status }, 'bot');
        await ctx.answer({
          message: {
            text: `Жалоба №${String(complaint.id)}: ${status === 'resolved' ? 'решена' : 'отклонена'}.`,
          },
        });
      });
  }

  function askBlock(ctx: BotContext, [value]: string[]): Promise<void> {
    return guard(ctx, async () => {
      const venueId = parseId(value);
      if (venueId === null) {
        await answerStale(ctx);
        return;
      }
      await ctx.saveState({
        ...ctx.state,
        flow: startFlow({ name: 'admin_block', venueId }, ctx.now),
      });
      await ctx.answer({
        message: {
          text: ADMIN_TEXTS.askReason,
          buttons: [[callback(ADMIN_BUTTONS.cancel, payload('ad', 'bc'))]],
        },
      });
    });
  }

  function cancelBlock(ctx: BotContext): Promise<void> {
    return guard(ctx, async () => {
      await ctx.saveState({ ...ctx.state, flow: null });
      await ctx.answer({ message: { text: ADMIN_TEXTS.cancelled } });
    });
  }

  async function onReason(ctx: BotContext, message: MessageInput): Promise<boolean> {
    const flow = ctx.state.flow;
    if (flow?.name !== 'admin_block') return false;
    const reason = message.text?.trim() ?? '';
    if (reason.length === 0 || message.text?.startsWith('/') === true) return false;
    if (reason.length > BLOCK_REASON_LIMIT) {
      await ctx.reply({ text: ADMIN_TEXTS.tooLong });
      return true;
    }
    await guarded(
      ctx,
      async () => {
        await moderation.blockVenue(ctx.user.id, flow.venueId, reason, 'bot');
        await ctx.saveState({ ...ctx.state, flow: null });
        await ctx.reply({ text: ADMIN_TEXTS.blocked });
      },
      async () => {
        await ctx.saveState({ ...ctx.state, flow: null });
      },
    );
    return true;
  }

  async function onRejectionNote(ctx: BotContext, message: MessageInput): Promise<boolean> {
    const flow = ctx.state.flow;
    if (flow?.name !== 'admin_reject') return false;
    const note = message.text?.trim() ?? '';
    if (note.length === 0 || message.text?.startsWith('/') === true) return false;
    if (note.length > COMPANY_NOTE_LIMIT) {
      await ctx.reply({ text: ADMIN_TEXTS.noteTooLong });
      return true;
    }
    await guarded(
      ctx,
      async () => {
        await moderation.decideCompanyVerification(
          ctx.user.id,
          flow.companyId,
          { decision: 'rejected', note },
          'bot',
        );
        await ctx.saveState({ ...ctx.state, flow: null });
        await ctx.reply({ text: ADMIN_TEXTS.rejected });
      },
      async () => {
        await ctx.saveState({ ...ctx.state, flow: null });
      },
    );
    return true;
  }

  return {
    commands: { admin: home },
    callbacks: {
      ad: byAction({
        cl: list,
        ok: decide('resolved'),
        no: decide('rejected'),
        bv: askBlock,
        bc: cancelBlock,
        cv: verifyCompany,
        cr: askRejection,
        rr: rejectWithReason,
        ro: askOtherReason,
        rc: cancelRejection,
        oi: ownerInvite,
      }),
    },
    flows: { admin_block: onReason, admin_reject: onRejectionNote },
  };
}
