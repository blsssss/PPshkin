import type { ParsedMenuItem } from '../domain/models.ts';
import type { Tag } from '../domain/vocabulary.ts';

export interface DishEstimate {
  title: string;
  portionG: number | null;
  kcalMin: number;
  kcalMax: number;
  proteinG: number;
  fatG: number;
  carbsG: number;
  tags: Tag[];
  confidence: number;
}

export const UNAVAILABLE_REASONS = [
  'disabled',
  'timeout',
  'provider_error',
  'invalid_response',
  'quota_exceeded',
  'unsupported_image',
] as const;
export type UnavailableReason = (typeof UNAVAILABLE_REASONS)[number];

export type DishRecognition =
  | { status: 'recognized'; items: DishEstimate[]; basis: string; model: string }
  | { status: 'not_food'; basis: string; model: string }
  | { status: 'unavailable'; reason: UnavailableReason };

export type MenuParseResult =
  | { status: 'parsed'; venueName: string | null; items: ParsedMenuItem[]; model: string }
  | { status: 'unavailable'; reason: UnavailableReason };

export interface DishRecognizer {
  fromPhoto(image: Buffer): Promise<DishRecognition>;
  fromText(description: string): Promise<DishRecognition>;
}

export interface MenuParser {
  fromPhoto(image: Buffer): Promise<MenuParseResult>;
  fromText(text: string): Promise<MenuParseResult>;
}
