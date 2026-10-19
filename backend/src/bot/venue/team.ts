import QRCode from 'qrcode';
import { can, canInviteRole } from '../../domain/roles.ts';
import type { MemberView } from '../../services/companies.ts';
import { AppError } from '../../shared/errors.ts';
import { escapeMarkdown } from '../../integrations/max/messenger.ts';
import { byAction } from '../callbacks.ts';
import type { BotContext, BotKit, StartLinkHandler } from '../context.ts';
import { bold } from '../texts.ts';
import { homeRow, venueButton } from './keyboards.ts';
import { venueCallback, withDefault } from './owner.ts';
import {
  INVITE_ACCEPTED,
  INVITE_DECLINED,
  ROLE_LABELS,
  TEAM_EMPTY,
  VENUE_BUTTONS,
  VENUE_ERROR_TEXTS,
  type VenueErrorCode,
} from './texts.ts';

const INVITE_ERRORS = [
  'invite_not_found',
  'invite_expired',
  'invite_used',
  'already_member',
] as const satisfies readonly VenueErrorCode[];
const QR_OPTIONS = { type: 'png', width: 512, margin: 2, errorCorrectionLevel: 'M' } as const;
const INVITE_ROLES = ['cashier', 'manager'] as const;
const TOKEN = /^[A-Za-z0-9]{24}$/;

function isInviteRole(value: string | undefined): value is (typeof INVITE_ROLES)[number] {
  return INVITE_ROLES.some((role) => role === value);
}

function memberLine(member: MemberView): string {
  const name = member.firstName === null ? `id ${member.userId}` : escapeMarkdown(member.firstName);
  return `${name}: ${ROLE_LABELS[member.role]}`;
}

function teamText(members: readonly MemberView[]): string {
  const others = members.length > 1 ? members.map(memberLine) : [TEAM_EMPTY];
  return [bold('Сотрудники'), ...others].join('\n');
}

function knownInviteError(error: unknown): (typeof INVITE_ERRORS)[number] | null {
  if (!(error instanceof AppError)) return null;
  return INVITE_ERRORS.find((code) => code === error.code) ?? null;
}

export function createTeamScreens({ services, messenger, logger }: BotKit) {
  const { companies } = services;

  const show = venueCallback(companies, 'team.invite', async (ctx, venue, _args, role) => {
    const place = (await companies.workplaces(ctx.user.id)).find((entry) => entry.venue.id === venue.id);
    const companyId = place?.company?.id;
    if (companyId === undefined) {
      await ctx.answer({ message: { text: VENUE_ERROR_TEXTS.venue_forbidden, buttons: [homeRow()] } });
      return;
    }
    const members = await companies.listMembers(ctx.user.id, companyId);
    const invites = INVITE_ROLES.filter((invited) => canInviteRole(role, invited));
    await ctx.answer({
      message: {
        text: teamText(members),
        buttons: [
          ...invites.map((invited) => [
            venueButton(
              invited === 'cashier' ? VENUE_BUTTONS.inviteCashier : VENUE_BUTTONS.inviteManager,
              'team',
              'inv',
              invited,
            ),
          ]),
          homeRow(),
        ],
      },
    });
  });

  async function sendQr(ctx: BotContext, link: string): Promise<string | null> {
    try {
      return await messenger.uploadImage(await QRCode.toBuffer(link, QR_OPTIONS), 'invite.png');
    } catch (error) {
      logger.warn({ err: error, userId: ctx.user.id }, 'invite qr was not uploaded');
      return null;
    }
  }

  const invite = venueCallback(companies, 'team.invite', async (ctx, venue, [value]) => {
    const place = (await companies.workplaces(ctx.user.id)).find((entry) => entry.venue.id === venue.id);
    const companyId = place?.company?.id;
    if (!isInviteRole(value) || companyId === undefined || !place || !can(place.role, 'team.invite')) {
      await ctx.answer({ message: { text: VENUE_ERROR_TEXTS.venue_forbidden, buttons: [homeRow()] } });
      return;
    }
    let created;
    try {
      created = await companies.createInvite(ctx.user.id, companyId, { role: value, venueId: venue.id });
    } catch (error) {
      if (!(error instanceof AppError) || !['invite_limit', 'company_forbidden'].includes(error.code))
        throw error;
      await ctx.answer({
        message: {
          text: VENUE_ERROR_TEXTS[error.code === 'invite_limit' ? 'invite_limit' : 'company_forbidden'],
          buttons: [homeRow()],
        },
      });
      return;
    }
    await ctx.answer({ notification: 'Приглашение готово' });
    const token = await sendQr(ctx, created.botLink);
    await ctx.reply({
      text: [
        bold(`Приглашение: ${ROLE_LABELS[value]}, ${escapeMarkdown(venue.name)}`),
        'Пришлите ссылку сотруднику или покажите QR. Приглашение действует 72 часа и принимается один раз.',
        created.botLink,
      ].join('\n'),
      ...(token === null ? {} : { imageTokens: [token] }),
      buttons: [[venueButton(VENUE_BUTTONS.team, 'team'), venueButton(VENUE_BUTTONS.home, 'home')]],
    });
  });

  const joinLink: StartLinkHandler = async (ctx, token) => {
    if (!TOKEN.test(token)) {
      await ctx.reply({ text: VENUE_ERROR_TEXTS.invite_not_found });
      return;
    }
    try {
      const preview = await companies.previewInvite(token);
      await ctx.reply({
        text: [
          `Вас приглашают в «${escapeMarkdown(preview.companyName)}»: ${ROLE_LABELS[preview.role]}, ${preview.venueName === null ? 'все заведения' : escapeMarkdown(preview.venueName)}.`,
          'Приглашение действует ограниченное время.',
        ].join(' '),
        buttons: [
          [
            venueButton(VENUE_BUTTONS.accept, 'inv', 'ok', token),
            venueButton(VENUE_BUTTONS.decline, 'inv', 'no'),
          ],
        ],
      });
    } catch (error) {
      const code = knownInviteError(error);
      if (code === null) throw error;
      await ctx.reply({ text: VENUE_ERROR_TEXTS[code] });
    }
  };

  async function accept(ctx: BotContext, [token = '']: string[]): Promise<void> {
    if (!TOKEN.test(token)) {
      await ctx.answer({ message: { text: VENUE_ERROR_TEXTS.invite_not_found } });
      return;
    }
    try {
      const accepted = await companies.acceptInvite(ctx.user.id, token);
      if (accepted.workplace.venueScoped) {
        await ctx.saveState({ ...ctx.state, activeVenueId: accepted.workplace.venue.id });
      }
      await ctx.answer({ message: { text: INVITE_ACCEPTED } });
    } catch (error) {
      const code = knownInviteError(error);
      if (code === null) throw error;
      await ctx.answer({ message: { text: VENUE_ERROR_TEXTS[code] } });
    }
  }

  const decline = async (ctx: BotContext): Promise<void> => {
    await ctx.answer({ message: { text: INVITE_DECLINED } });
  };

  return {
    team: withDefault(show, { inv: invite }),
    joinLink,
    invites: byAction({ ok: accept, no: decline }),
  };
}
