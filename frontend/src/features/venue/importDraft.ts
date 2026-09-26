import {
  itemFieldFromPath,
  itemFormFrom,
  normalizeName,
  validateItem,
  type ItemErrors,
  type ItemForm,
  type MenuImport,
  type MenuItem,
  type ParsedMenuItemInput,
} from './model.ts';

const KEY = 'ppshkin.menuImport';
export const MAX_APPLY_ITEMS = 80;

export interface ReviewRow {
  key: number;
  selected: boolean;
  duplicate: boolean;
  form: ItemForm;
}

interface ImportDraft {
  venueId: number;
  importId: number;
  rows: ReviewRow[] | null;
}

const TEXT_FIELDS = [
  'name',
  'description',
  'priceRub',
  'weightG',
  'kcal',
  'proteinG',
  'fatG',
  'carbsG',
] as const;

function isRow(value: unknown): value is ReviewRow {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  const form = row.form as Record<string, unknown> | null | undefined;
  return (
    typeof row.key === 'number' &&
    typeof row.selected === 'boolean' &&
    typeof row.duplicate === 'boolean' &&
    typeof form === 'object' &&
    form !== null &&
    TEXT_FIELDS.every((field) => typeof form[field] === 'string') &&
    (form.category === null || typeof form.category === 'string') &&
    Array.isArray(form.tags) &&
    typeof form.isAvailable === 'boolean'
  );
}

function isDraft(value: unknown): value is ImportDraft {
  if (typeof value !== 'object' || value === null) return false;
  const draft = value as Record<string, unknown>;
  return (
    typeof draft.venueId === 'number' &&
    typeof draft.importId === 'number' &&
    (draft.rows === null || (Array.isArray(draft.rows) && draft.rows.every(isRow)))
  );
}

export function readImportDraft(): ImportDraft | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (isDraft(parsed)) return parsed;
    localStorage.removeItem(KEY);
    return null;
  } catch {
    return null;
  }
}

export function saveImportDraft(draft: ImportDraft): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(draft));
  } catch {
    return;
  }
}

export function clearImportDraft(importId?: number): void {
  try {
    if (importId !== undefined && readImportDraft()?.importId !== importId) return;
    localStorage.removeItem(KEY);
  } catch {
    return;
  }
}

export function buildRows(parsed: MenuImport['items'], menu: readonly MenuItem[]): ReviewRow[] {
  const existing = new Set(menu.map((item) => normalizeName(item.name)));
  return parsed.map((item, key) => {
    const duplicate = existing.has(normalizeName(item.name));
    return { key, selected: !duplicate, duplicate, form: itemFormFrom(item) };
  });
}

export function rowErrors(rows: readonly ReviewRow[]): Map<number, ItemErrors> {
  const result = new Map<number, ItemErrors>();
  for (const row of rows) {
    if (!row.selected) continue;
    const { errors } = validateItem(row.form);
    if (Object.keys(errors).length > 0) result.set(row.key, errors);
  }
  return result;
}

export function applyPayload(rows: readonly ReviewRow[]): { items: ParsedMenuItemInput[]; keys: number[] } {
  const items: ParsedMenuItemInput[] = [];
  const keys: number[] = [];
  for (const row of rows) {
    if (!row.selected) continue;
    const { input } = validateItem(row.form);
    if (input === null) continue;
    items.push({
      name: input.name,
      description: input.description ?? null,
      category: input.category,
      priceRub: input.priceRub,
      weightG: input.weightG ?? null,
      kcal: input.kcal,
      proteinG: input.proteinG ?? null,
      fatG: input.fatG ?? null,
      carbsG: input.carbsG ?? null,
      tags: input.tags ?? [],
    });
    keys.push(row.key);
  }
  return { items, keys };
}

export function mapApplyErrors(
  fieldErrors: Record<string, string>,
  keys: readonly number[],
): Map<number, ItemErrors> {
  const result = new Map<number, ItemErrors>();
  for (const [path, message] of Object.entries(fieldErrors)) {
    const match = /^items\.(\d+)\.(.+)$/.exec(path);
    if (match === null) continue;
    const key = keys[Number(match[1])];
    const field = itemFieldFromPath(match[2] ?? '');
    if (key === undefined || field === null) continue;
    result.set(key, { ...result.get(key), [field]: message });
  }
  return result;
}
