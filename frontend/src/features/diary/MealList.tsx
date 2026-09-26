import { Link } from 'react-router';
import { formatKcalRange, formatLocalTime } from '../../shared/format.ts';
import { MEAL_SLOT_LABELS, type MealSlot } from '../../shared/vocabulary.ts';
import type { Meal } from './queries.ts';
import styles from './Diary.module.css';

const SLOT_ORDER: readonly MealSlot[] = ['breakfast', 'lunch', 'snack', 'dinner'];

const SOURCE_LABELS: Record<Meal['source'], string> = {
  photo: 'Фото',
  text: 'Текст',
  manual: 'Вручную',
  booking: 'Бронь',
  demo: 'Пример',
};

function slotTitle(slot: MealSlot): string {
  const label = MEAL_SLOT_LABELS[slot];
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function MealList({
  meals,
  date,
  timeZone,
}: {
  meals: readonly Meal[];
  date: string;
  timeZone: string;
}) {
  const groups = SLOT_ORDER.map((slot) => ({
    slot,
    meals: meals.filter((meal) => meal.slot === slot).sort((a, b) => a.eatenAt.localeCompare(b.eatenAt)),
  })).filter((group) => group.meals.length > 0);

  return (
    <div className={styles.slots}>
      {groups.map((group) => (
        <section key={group.slot} aria-label={slotTitle(group.slot)}>
          <h3 className={styles.slotTitle}>{slotTitle(group.slot)}</h3>
          <ul className={styles.meals}>
            {group.meals.map((meal) => (
              <li key={meal.id}>
                <Link className={styles.meal} to={`/diary/meals/${meal.id}?date=${date}`}>
                  <span className={styles.mealTime}>{formatLocalTime(meal.eatenAt, timeZone)}</span>
                  <span className={styles.mealTitle}>{meal.title}</span>
                  <span className={styles.mealKcal}>{formatKcalRange(meal.kcalMin, meal.kcalMax)}</span>
                  <span className={styles.mealSource}>{SOURCE_LABELS[meal.source]}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
