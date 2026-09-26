import { z } from 'zod';
import { VENUE_CATEGORIES } from '../../domain/vocabulary.ts';

const VENUE_CREATE_STEPS = [
  'name',
  'address',
  'location',
  'category',
  'hours',
  'hours_input',
  'confirm',
] as const;
export type VenueCreateStep = (typeof VENUE_CREATE_STEPS)[number];

const DEAL_WIZARD_STEPS = [
  'item',
  'quantity',
  'quantity_input',
  'discount',
  'price_input',
  'until',
  'confirm',
] as const;
export type DealWizardStep = (typeof DEAL_WIZARD_STEPS)[number];

const ClockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const PositiveInt = z.number().int().positive();
const WizardMessageId = z.string().min(1).nullable();

const VenueDraftSchema = z.object({
  name: z.string().min(1).optional(),
  address: z.string().min(1).optional(),
  location: z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }).optional(),
  category: z.enum(VENUE_CATEGORIES).optional(),
  opensAt: ClockTime.optional(),
  closesAt: ClockTime.optional(),
});

const DealDraftSchema = z.object({
  menuItemId: PositiveInt.optional(),
  itemName: z.string().min(1).optional(),
  itemPriceRub: PositiveInt.optional(),
  quantity: PositiveInt.optional(),
  priceRub: PositiveInt.optional(),
  endsAt: z.iso.datetime().optional(),
});

export type VenueDraft = z.infer<typeof VenueDraftSchema>;
export type DealDraft = z.infer<typeof DealDraftSchema>;

export const VENUE_FLOWS = [
  z.object({
    name: z.literal('venue_create'),
    step: z.enum(VENUE_CREATE_STEPS),
    draft: VenueDraftSchema,
    messageId: WizardMessageId,
  }),
  z.object({ name: z.literal('menu_upload') }),
  z.object({
    name: z.literal('deal_wizard'),
    step: z.enum(DEAL_WIZARD_STEPS),
    page: PositiveInt,
    draft: DealDraftSchema,
    messageId: WizardMessageId,
  }),
  z.object({ name: z.literal('redeem_input') }),
] as const;
