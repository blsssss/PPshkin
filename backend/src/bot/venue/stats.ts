import { localDate } from '../../shared/time.ts';
import { answerStale } from '../callbacks.ts';
import type { BotKit } from '../context.ts';
import { appRow, homeRow, venueButton } from './keyboards.ts';
import { ownerCallback } from './owner.ts';
import { statsText, VENUE_BUTTONS } from './texts.ts';

const PERIODS = ['today', 'week'] as const;

function isPeriod(value: string | undefined): value is (typeof PERIODS)[number] {
  return PERIODS.some((period) => period === value);
}

export function createStatsScreens({ services }: BotKit) {
  const { venues, analytics } = services;

  const show = ownerCallback(venues, async (ctx, venue, [period]) => {
    if (!isPeriod(period)) {
      await answerStale(ctx);
      return;
    }
    const today = localDate(ctx.now, venue.timezone);
    const stats = await analytics.get(ctx.user.id, period === 'today' ? { from: today, to: today } : {});
    await ctx.answer({
      message: {
        text: statsText(stats),
        buttons: [
          [
            venueButton(VENUE_BUTTONS.today, 'stats', 'today'),
            venueButton(VENUE_BUTTONS.week, 'stats', 'week'),
          ],
          ...appRow(ctx.miniAppEnabled),
          homeRow(),
        ],
      },
    });
  });

  return { show };
}
