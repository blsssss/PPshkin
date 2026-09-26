import { byAction } from '../callbacks.ts';
import type { BotKit, BotModule } from '../context.ts';
import { createBookingScreens } from './bookings.ts';
import { createDealScreens } from './deals.ts';
import { createMenuScreens, type ImportWaiting } from './menu.ts';
import { withDefault } from './owner.ts';
import { createStatsScreens } from './stats.ts';
import { createWorkspace } from './workspace.ts';

export function createVenueModule(kit: BotKit, waiting: ImportWaiting): BotModule {
  const workspace = createWorkspace(kit);
  const menu = createMenuScreens(kit, waiting);
  const deals = createDealScreens(kit);
  const bookings = createBookingScreens(kit);
  const stats = createStatsScreens(kit);

  return {
    commands: { venue: workspace.open },
    callbacks: {
      vn: byAction({
        home: workspace.home,
        new: workspace.create,
        demo: workspace.claimDemo,
        menu: withDefault(menu.show, { upload: menu.upload, cancel: menu.cancelUpload }),
        imp: byAction({ apply: menu.apply }),
        deals: deals.list,
        dl: deals.wizard,
        bk: bookings.list,
        redeem: bookings.askCode,
        rd: bookings.confirm,
        rd_ok: bookings.redeem,
        rd_no: bookings.keep,
        stats: stats.show,
      }),
    },
    flows: {
      venue_create: workspace.onInput,
      menu_upload: menu.onUpload,
      deal_wizard: deals.onInput,
      redeem_input: bookings.onCode,
    },
    startLinks: { r: bookings.staffLink },
  };
}
