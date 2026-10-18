import { isNotificationKind, NOTIFICATION_KIND_DESCRIPTIONS } from '../../domain/notifications.ts';
import type { OutgoingMessage } from '../../ports/messenger.ts';
import type { NotificationSettings } from '../../services/notification-settings.ts';
import { answerStale, byAction, payload } from '../callbacks.ts';
import type { BotContext, BotKit, BotModule } from '../context.ts';
import { callback, link, miniAppUrl } from '../keyboards.ts';
import { BUTTONS, NOTIFICATION_TURNED_OFF, notificationsText, notificationToggle } from '../texts.ts';
import { profileMessage } from './profile.ts';

export const NOTIFICATIONS_START_PARAM = 'notifications';

export function notificationsScreen(settings: NotificationSettings, ctx: BotContext): OutgoingMessage {
  const toggles = settings.kinds
    .filter(({ editable }) => editable)
    .map(({ kind, enabled }) => [
      callback(
        notificationToggle(NOTIFICATION_KIND_DESCRIPTIONS[kind].label, enabled),
        payload('nt', 'tg', kind),
      ),
    ]);
  return {
    text: notificationsText(settings.quietHours),
    buttons: [
      ...toggles,
      ...(ctx.miniAppEnabled
        ? [[link(BUTTONS.configure, miniAppUrl(ctx.botUsername, NOTIFICATIONS_START_PARAM))]]
        : []),
      [callback(BUTTONS.back, payload('nt', 'back'))],
    ],
  };
}

export function createNotificationsModule({ services }: BotKit): BotModule {
  const { notificationSettings, profile } = services;

  async function editableKind(ctx: BotContext, value: string | undefined) {
    if (
      value === undefined ||
      !isNotificationKind(value) ||
      !NOTIFICATION_KIND_DESCRIPTIONS[value].editable
    ) {
      await answerStale(ctx);
      return null;
    }
    return value;
  }

  async function turnOff(ctx: BotContext, [value]: string[]): Promise<void> {
    const kind = await editableKind(ctx, value);
    if (kind === null) return;
    await notificationSettings.update(ctx.user.id, { kinds: [{ kind, enabled: false }] });
    await ctx.answer({ notification: NOTIFICATION_TURNED_OFF });
  }

  async function toggle(ctx: BotContext, [value]: string[]): Promise<void> {
    const kind = await editableKind(ctx, value);
    if (kind === null) return;
    const current = await notificationSettings.get(ctx.user.id);
    const setting = current.kinds.find((candidate) => candidate.kind === kind);
    if (!setting) {
      await answerStale(ctx);
      return;
    }
    const updated = await notificationSettings.update(ctx.user.id, {
      kinds: [{ kind, enabled: !setting.enabled }],
    });
    await ctx.answer({ message: notificationsScreen(updated, ctx) });
  }

  return {
    callbacks: {
      nt: byAction({
        ls: async (ctx) => {
          await ctx.answer({
            message: notificationsScreen(await notificationSettings.get(ctx.user.id), ctx),
          });
        },
        off: turnOff,
        tg: toggle,
        back: async (ctx) => {
          await ctx.answer({ message: await profileMessage(profile, ctx.user.id) });
        },
      }),
    },
  };
}
