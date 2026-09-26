import { formatKcal, formatKcalRange } from '../../shared/format.ts';
import type { DiaryDay } from './queries.ts';
import styles from './Diary.module.css';

function grams(value: number): string {
  return `${Math.round(value * 10) / 10}`.replace('.', ',');
}

export function DaySummary({ day }: { day: DiaryDay }) {
  const eaten = day.totals.kcal;
  const over = eaten - day.targetKcal;
  const progress = day.targetKcal > 0 ? Math.min(100, Math.round((eaten / day.targetKcal) * 100)) : 0;
  return (
    <section className={styles.summary} aria-label="Итоги дня">
      <p className={styles.remaining}>
        {over > 0
          ? `Ориентир превышен на ${formatKcal(over)}`
          : `Осталось около ${formatKcal(day.remainingKcal)}`}
      </p>
      <div
        className={styles.progress}
        role="progressbar"
        aria-label="Съедено из ориентира"
        aria-valuemin={0}
        aria-valuemax={day.targetKcal}
        aria-valuenow={Math.min(eaten, day.targetKcal)}
      >
        <span
          className={over > 0 ? styles.progressOver : styles.progressFill}
          style={{ width: `${progress}%` }}
        />
      </div>
      <p className={styles.eaten}>
        Съедено около {formatKcal(eaten)} из {formatKcal(day.targetKcal)}
        {day.totals.meals > 0 && `, диапазон ${formatKcalRange(day.totals.kcalMin, day.totals.kcalMax)}`}
      </p>
      <dl className={styles.macros}>
        <div>
          <dt>Белки</dt>
          <dd>{grams(day.totals.proteinG)} г</dd>
        </div>
        <div>
          <dt>Жиры</dt>
          <dd>{grams(day.totals.fatG)} г</dd>
        </div>
        <div>
          <dt>Углеводы</dt>
          <dd>{grams(day.totals.carbsG)} г</dd>
        </div>
      </dl>
    </section>
  );
}
