import { maybeOne, one, type Queryable } from '../db/pool.ts';
import type { MenuItem } from '../domain/models.ts';
import { onlyKnownTags, type MenuCategory, type NutritionSource, type Tag } from '../domain/vocabulary.ts';

interface MenuItemRow {
  id: number;
  venue_id: number;
  name: string;
  description: string | null;
  category: MenuCategory;
  price_rub: number;
  weight_g: number | null;
  kcal: number;
  protein_g: number | null;
  fat_g: number | null;
  carbs_g: number | null;
  nutrition_source: NutritionSource;
  tags: string[];
  is_available: boolean;
  archived_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

const MENU_ITEM_COLUMNS = `id, venue_id, name, description, category, price_rub, weight_g, kcal, protein_g, fat_g,
  carbs_g, nutrition_source, tags, is_available, archived_at, created_at, updated_at`;

function mapMenuItem(row: MenuItemRow): MenuItem {
  return {
    id: row.id,
    venueId: row.venue_id,
    name: row.name,
    description: row.description,
    category: row.category,
    priceRub: row.price_rub,
    weightG: row.weight_g,
    kcal: row.kcal,
    proteinG: row.protein_g,
    fatG: row.fat_g,
    carbsG: row.carbs_g,
    nutritionSource: row.nutrition_source,
    tags: onlyKnownTags(row.tags),
    isAvailable: row.is_available,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface MenuItemFields {
  name: string;
  description: string | null;
  category: MenuCategory;
  priceRub: number;
  weightG: number | null;
  kcal: number;
  proteinG: number | null;
  fatG: number | null;
  carbsG: number | null;
  nutritionSource: NutritionSource;
  tags: Tag[];
  isAvailable: boolean;
}

function fieldValues(fields: MenuItemFields): unknown[] {
  return [
    fields.name,
    fields.description,
    fields.category,
    fields.priceRub,
    fields.weightG,
    fields.kcal,
    fields.proteinG,
    fields.fatG,
    fields.carbsG,
    fields.nutritionSource,
    fields.tags,
    fields.isAvailable,
  ];
}

export async function insert(
  db: Queryable,
  venueId: number,
  fields: MenuItemFields,
  now: Date,
): Promise<MenuItem> {
  const row = await one<MenuItemRow>(
    db,
    `insert into menu_items (name, description, category, price_rub, weight_g, kcal, protein_g, fat_g, carbs_g,
                             nutrition_source, tags, is_available, venue_id, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14)
     returning ${MENU_ITEM_COLUMNS}`,
    [...fieldValues(fields), venueId, now],
  );
  return mapMenuItem(row);
}

export async function update(
  db: Queryable,
  id: number,
  fields: MenuItemFields,
  now: Date,
): Promise<MenuItem> {
  const row = await one<MenuItemRow>(
    db,
    `update menu_items
        set name = $1, description = $2, category = $3, price_rub = $4, weight_g = $5, kcal = $6,
            protein_g = $7, fat_g = $8, carbs_g = $9, nutrition_source = $10, tags = $11, is_available = $12,
            updated_at = $14
      where id = $13
      returning ${MENU_ITEM_COLUMNS}`,
    [...fieldValues(fields), id, now],
  );
  return mapMenuItem(row);
}

export async function archive(db: Queryable, id: number, now: Date): Promise<void> {
  await db.query('update menu_items set archived_at = $2, updated_at = $2 where id = $1', [id, now]);
}

export async function lockOnMenu(db: Queryable, venueId: number, id: number): Promise<MenuItem | null> {
  const row = await maybeOne<MenuItemRow>(
    db,
    `select ${MENU_ITEM_COLUMNS} from menu_items
      where venue_id = $1 and id = $2 and archived_at is null
      for update`,
    [venueId, id],
  );
  return row ? mapMenuItem(row) : null;
}

export async function lockById(db: Queryable, id: number): Promise<MenuItem> {
  const row = await one<MenuItemRow>(
    db,
    `select ${MENU_ITEM_COLUMNS} from menu_items where id = $1 for update`,
    [id],
  );
  return mapMenuItem(row);
}

export async function listOnMenu(db: Queryable, venueId: number): Promise<MenuItem[]> {
  const { rows } = await db.query<MenuItemRow>(
    `select ${MENU_ITEM_COLUMNS} from menu_items where venue_id = $1 and archived_at is null order by id`,
    [venueId],
  );
  return rows.map(mapMenuItem);
}

export async function listAvailable(db: Queryable, venueId: number): Promise<MenuItem[]> {
  const { rows } = await db.query<MenuItemRow>(
    `select ${MENU_ITEM_COLUMNS} from menu_items
      where venue_id = $1 and archived_at is null and is_available
      order by id`,
    [venueId],
  );
  return rows.map(mapMenuItem);
}

export async function listAvailableInVenues(db: Queryable, venueIds: readonly number[]): Promise<MenuItem[]> {
  if (venueIds.length === 0) return [];
  const { rows } = await db.query<MenuItemRow>(
    `select ${MENU_ITEM_COLUMNS} from menu_items
      where venue_id = any($1::bigint[]) and archived_at is null and is_available
      order by id`,
    [venueIds],
  );
  return rows.map(mapMenuItem);
}

export async function findByIds(db: Queryable, ids: readonly number[]): Promise<MenuItem[]> {
  if (ids.length === 0) return [];
  const { rows } = await db.query<MenuItemRow>(
    `select ${MENU_ITEM_COLUMNS} from menu_items where id = any($1::bigint[]) order by id`,
    [ids],
  );
  return rows.map(mapMenuItem);
}

export async function copyAvailable(
  db: Queryable,
  fromVenueId: number,
  toVenueId: number,
  now: Date,
): Promise<MenuItem[]> {
  const { rows } = await db.query<MenuItemRow>(
    `insert into menu_items (venue_id, name, description, category, price_rub, weight_g, kcal, protein_g, fat_g,
                             carbs_g, nutrition_source, tags, is_available, created_at, updated_at)
     select $2, name, description, category, price_rub, weight_g, kcal, protein_g, fat_g, carbs_g,
            nutrition_source, tags, true, $3, $3
       from menu_items
      where venue_id = $1 and archived_at is null and is_available
      order by id
     returning ${MENU_ITEM_COLUMNS}`,
    [fromVenueId, toVenueId, now],
  );
  return rows.map(mapMenuItem).sort((left, right) => left.id - right.id);
}
