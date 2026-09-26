import { z } from 'zod';
import { onlyKnownTags } from '../../domain/vocabulary.ts';

const id = z.number().int().positive();

const OfferCardSchema = z.object({
  offerId: id,
  menuItemId: id,
  dealId: id.nullable(),
  venueId: id,
  headline: z.string().min(1),
  itemName: z.string().min(1),
  venueName: z.string().min(1),
  venueAddress: z.string().min(1),
  location: z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) }),
  priceRub: z.number().nonnegative(),
  kcal: z.number().nonnegative(),
  distanceM: z.number().nonnegative().nullable(),
  reasons: z.array(z.string()),
  assumptions: z.array(z.string()),
  tags: z.array(z.string()).transform(onlyKnownTags),
});

export const OfferQueueSchema = z.object({
  messageId: z.string().min(1),
  cards: z.array(OfferCardSchema).min(1),
  expiresAt: z.iso.datetime(),
});

export type OfferCard = z.infer<typeof OfferCardSchema>;
export type OfferQueue = z.infer<typeof OfferQueueSchema>;
