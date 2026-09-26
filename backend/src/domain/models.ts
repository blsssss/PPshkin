import type {
  BookingStatus,
  ConsentChannel,
  ConsentKind,
  DeclineReason,
  Goal,
  MealSource,
  MenuCategory,
  MenuImportStatus,
  NutritionSource,
  OfferChannel,
  OfferStatus,
  Tag,
  VenueCategory,
} from './vocabulary.ts';

export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface Macros {
  proteinG: number | null;
  fatG: number | null;
  carbsG: number | null;
}

export interface User {
  id: number;
  firstName: string | null;
  username: string | null;
  timezone: string;
  kcalTarget: number;
  goal: Goal | null;
  dislikedTags: Tag[];
  location: GeoPoint | null;
  locationUpdatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Consent {
  id: number;
  userId: number;
  kind: ConsentKind;
  version: string;
  channel: ConsentChannel;
  grantedAt: Date;
  revokedAt: Date | null;
}

export interface Meal extends Macros {
  id: number;
  userId: number;
  title: string;
  kcalMin: number;
  kcalMax: number;
  tags: Tag[];
  source: MealSource;
  confidence: number | null;
  eatenAt: Date;
  createdAt: Date;
}

export interface Venue {
  id: number;
  ownerId: number | null;
  name: string;
  address: string;
  category: VenueCategory;
  location: GeoPoint;
  opensAt: string;
  closesAt: string;
  timezone: string;
  isDemo: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface MenuItem extends Macros {
  id: number;
  venueId: number;
  name: string;
  description: string | null;
  category: MenuCategory;
  priceRub: number;
  weightG: number | null;
  kcal: number;
  nutritionSource: NutritionSource;
  tags: Tag[];
  isAvailable: boolean;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ParsedMenuItem {
  name: string;
  description: string | null;
  category: MenuCategory;
  priceRub: number | null;
  weightG: number | null;
  kcal: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  tags: Tag[];
}

export interface MenuImport {
  id: number;
  venueId: number;
  source: 'photo' | 'text';
  status: MenuImportStatus;
  items: ParsedMenuItem[];
  error: string | null;
  model: string | null;
  createdAt: Date;
  completedAt: Date | null;
}

export interface Deal {
  id: number;
  venueId: number;
  menuItemId: number;
  priceRub: number;
  quantityTotal: number;
  quantityLeft: number;
  startsAt: Date;
  endsAt: Date;
  cancelledAt: Date | null;
  createdAt: Date;
}

export const INTENT_FACTORS = ['fit', 'taste', 'habit', 'macros', 'proximity', 'deal', 'novelty'] as const;
export type IntentFactor = (typeof INTENT_FACTORS)[number];

export interface FactorScore {
  factor: IntentFactor;
  value: number;
  weight: number;
}

export interface OfferExplanation {
  headline: string;
  facts: string[];
  calculations: string[];
  assumptions: string[];
  factors: FactorScore[];
}

export interface Offer {
  id: number;
  userId: number | null;
  venueId: number;
  menuItemId: number;
  dealId: number | null;
  channel: OfferChannel;
  score: number;
  explanation: OfferExplanation;
  status: OfferStatus;
  declineReason: DeclineReason | null;
  createdAt: Date;
  respondedAt: Date | null;
}

export interface Booking {
  id: number;
  userId: number | null;
  venueId: number;
  menuItemId: number;
  dealId: number | null;
  offerId: number | null;
  code: string;
  itemName: string;
  priceRub: number;
  kcal: number;
  status: BookingStatus;
  expiresAt: Date;
  createdAt: Date;
  resolvedAt: Date | null;
}
