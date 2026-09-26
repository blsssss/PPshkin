import { maybeOne, one, type Queryable } from '../db/pool.ts';
import type { Meal } from '../domain/models.ts';
import { onlyKnownTags, type MealSource, type Tag } from '../domain/vocabulary.ts';

interface MealRow {
  id: number;
  user_id: number;
  title: string;
  kcal_min: number;
  kcal_max: number;
  protein_g: number | null;
  fat_g: number | null;
  carbs_g: number | null;
  tags: string[];
  source: MealSource;
  confidence: number | null;
  eaten_at: Date;
  created_at: Date;
}

const MEAL_COLUMNS = `id, user_id, title, kcal_min, kcal_max, protein_g, fat_g, carbs_g, tags, source,
  confidence, eaten_at, created_at`;

function mapMeal(row: MealRow): Meal {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    kcalMin: row.kcal_min,
    kcalMax: row.kcal_max,
    proteinG: row.protein_g,
    fatG: row.fat_g,
    carbsG: row.carbs_g,
    tags: onlyKnownTags(row.tags),
    source: row.source,
    confidence: row.confidence,
    eatenAt: row.eaten_at,
    createdAt: row.created_at,
  };
}

export interface NewMeal {
  userId: number;
  title: string;
  kcalMin: number;
  kcalMax: number;
  proteinG: number | null;
  fatG: number | null;
  carbsG: number | null;
  tags: Tag[];
  source: MealSource;
  confidence: number | null;
  eatenAt: Date;
}

export async function insert(db: Queryable, meal: NewMeal): Promise<Meal> {
  const row = await one<MealRow>(
    db,
    `insert into meals (user_id, title, kcal_min, kcal_max, protein_g, fat_g, carbs_g, tags, source, confidence, eaten_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     returning ${MEAL_COLUMNS}`,
    [
      meal.userId,
      meal.title,
      meal.kcalMin,
      meal.kcalMax,
      meal.proteinG,
      meal.fatG,
      meal.carbsG,
      meal.tags,
      meal.source,
      meal.confidence,
      meal.eatenAt,
    ],
  );
  return mapMeal(row);
}

export interface MealChanges {
  title?: string;
  kcalMin?: number;
  kcalMax?: number;
  proteinG?: number | null;
  fatG?: number | null;
  carbsG?: number | null;
  tags?: Tag[];
  eatenAt?: Date;
}

const CHANGE_COLUMNS = {
  title: 'title',
  kcalMin: 'kcal_min',
  kcalMax: 'kcal_max',
  proteinG: 'protein_g',
  fatG: 'fat_g',
  carbsG: 'carbs_g',
  tags: 'tags',
  eatenAt: 'eaten_at',
} as const satisfies Record<keyof MealChanges, string>;

export async function findById(db: Queryable, userId: number, id: number): Promise<Meal | null> {
  const row = await maybeOne<MealRow>(
    db,
    `select ${MEAL_COLUMNS} from meals where id = $1 and user_id = $2`,
    [id, userId],
  );
  return row ? mapMeal(row) : null;
}

export async function update(
  db: Queryable,
  userId: number,
  id: number,
  changes: MealChanges,
): Promise<Meal | null> {
  const fields = (Object.keys(CHANGE_COLUMNS) as (keyof MealChanges)[]).filter(
    (field) => changes[field] !== undefined,
  );
  if (fields.length === 0) return findById(db, userId, id);
  const assignments = fields.map((field, index) => `${CHANGE_COLUMNS[field]} = $${index + 3}`);
  const row = await maybeOne<MealRow>(
    db,
    `update meals set ${assignments.join(', ')}
      where id = $1 and user_id = $2
     returning ${MEAL_COLUMNS}`,
    [id, userId, ...fields.map((field) => changes[field])],
  );
  return row ? mapMeal(row) : null;
}

export async function remove(db: Queryable, userId: number, id: number): Promise<boolean> {
  const { rowCount } = await db.query('delete from meals where id = $1 and user_id = $2', [id, userId]);
  return rowCount === 1;
}

export async function listBetween(db: Queryable, userId: number, from: Date, to: Date): Promise<Meal[]> {
  const { rows } = await db.query<MealRow>(
    `select ${MEAL_COLUMNS} from meals
      where user_id = $1 and eaten_at >= $2 and eaten_at < $3
      order by eaten_at, id`,
    [userId, from, to],
  );
  return rows.map(mapMeal);
}

export async function listSince(db: Queryable, userId: number, since: Date): Promise<Meal[]> {
  const { rows } = await db.query<MealRow>(
    `select ${MEAL_COLUMNS} from meals
      where user_id = $1 and eaten_at >= $2
      order by eaten_at, id`,
    [userId, since],
  );
  return rows.map(mapMeal);
}
