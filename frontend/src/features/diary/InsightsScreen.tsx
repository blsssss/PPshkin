import { Button } from '@maxhub/max-ui';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { Schemas } from '../../api/client.ts';
import { userMessage } from '../../api/messages.ts';
import { useProfile } from '../../api/profile.ts';
import { formatKcal, plural } from '../../shared/format.ts';
import { BarChart } from '../../shared/ui/BarChart.tsx';
import { Page } from '../../shared/ui/Page.tsx';
import { ScreenHeader } from '../../shared/ui/ScreenHeader.tsx';
import { ScreenState } from '../../shared/ui/ScreenState.tsx';
import { SegmentedControl } from '../../shared/ui/SegmentedControl.tsx';
import { Skeleton } from '../../shared/ui/Skeleton.tsx';
import { dayOfMonth, formatLongDate } from './dates.ts';
import { useInsights, useSummary } from './queries.ts';
import styles from './Diary.module.css';

type Insights = Schemas['Insights'];
type Period = '7' | '14' | '30';

const PERIODS = [
  { value: '7', label: '7 дней' },
  { value: '14', label: '14 дней' },
  { value: '30', label: '30 дней' },
] as const;

function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

function hour(value: number): string {
  return `${String(value).padStart(2, '0')}:00`;
}

function slotSentence(slot: Insights['slots'][number]): string | null {
  if (slot.share === 0) return null;
  const parts = [`${slot.label.charAt(0).toUpperCase()}${slot.label.slice(1)} в ${percent(slot.share)} дней`];
  if (slot.typicalHour !== null) parts.push(`обычно около ${hour(slot.typicalHour)}`);
  if (slot.averageKcal !== null) parts.push(`примерно ${formatKcal(slot.averageKcal)}`);
  return parts.join(', ');
}

function Habits({ insights }: { insights: Insights }) {
  const navigate = useNavigate();
  const toEat = (
    <Button
      size="large"
      stretched
      onClick={() => {
        void navigate('/eat');
      }}
    >
      Подобрать блюдо под привычки
    </Button>
  );

  if (insights.readiness === 'empty') {
    return (
      <ScreenState
        status="empty"
        title="Запишите первый приём пищи, и здесь появятся ваши привычки"
        action={{
          label: 'Записать приём пищи',
          onClick: () => {
            void navigate('/diary?add=1');
          },
        }}
      />
    );
  }

  if (insights.readiness === 'collecting') {
    return (
      <div className={styles.habits}>
        <p className={styles.habit}>
          <span className={styles.habitValue}>
            Ещё {insights.mealsUntilReady} {plural(insights.mealsUntilReady, ['приём', 'приёма', 'приёмов'])}{' '}
            пищи
          </span>
          и подборка станет персональной. Дней с записями: {insights.daysTracked}.
        </p>
        {toEat}
      </div>
    );
  }

  const sentences = insights.slots.map(slotSentence).filter((sentence) => sentence !== null);
  return (
    <div className={styles.habits}>
      {insights.averageDailyKcal !== null && (
        <p className={styles.habit}>
          В среднем за день
          <span className={styles.habitValue}>{formatKcal(insights.averageDailyKcal)}</span>
        </p>
      )}
      {insights.topTags.length > 0 && (
        <p className={styles.habit}>
          Чаще всего выбираете
          <span className={styles.habitValue}>{insights.topTags.map((tag) => tag.label).join(', ')}</span>
        </p>
      )}
      {sentences.map((sentence) => (
        <p key={sentence} className={styles.habit}>
          {sentence}
        </p>
      ))}
      {insights.sweetTooth.share > 0 && (
        <p className={styles.habit}>
          Сладкое в {percent(insights.sweetTooth.share)} дней
          {insights.sweetTooth.typicalHour !== null &&
            `, обычно около ${hour(insights.sweetTooth.typicalHour)}`}
        </p>
      )}
      {insights.proteinShare !== null && (
        <p className={styles.habit}>Белок даёт {percent(insights.proteinShare)} калорий</p>
      )}
      {toEat}
    </div>
  );
}

export function InsightsScreen() {
  const navigate = useNavigate();
  const [period, setPeriod] = useState<Period>('7');
  const days = Number(period);
  const summary = useSummary(days);
  const insights = useInsights();
  const target = useProfile().data?.kcalTarget;
  const tracked = summary.data?.filter((day) => day.meals > 0) ?? [];
  const average =
    tracked.length > 0 ? Math.round(tracked.reduce((sum, day) => sum + day.kcal, 0) / tracked.length) : null;

  return (
    <Page>
      <ScreenHeader title="Неделя и привычки" back="/diary" />
      <div className={styles.period}>
        <SegmentedControl label="Период" options={PERIODS} value={period} onChange={setPeriod} />
      </div>
      {summary.isPending && <Skeleton height={160} />}
      {summary.isError && (
        <ScreenState
          status="error"
          title="Не удалось загрузить график"
          description={userMessage(summary.error)}
          error={summary.error}
          action={{
            label: 'Повторить',
            onClick: () => {
              void summary.refetch();
            },
          }}
        />
      )}
      {summary.data !== undefined && (
        <>
          <BarChart
            title={`Калории за ${days} ${plural(days, ['день', 'дня', 'дней'])}`}
            target={target}
            targetLabel={target === undefined ? undefined : `ориентир ${formatKcal(target)}`}
            bars={summary.data.map((day) => ({
              key: day.date,
              value: day.kcal,
              label: `${formatLongDate(day.date)}: ${formatKcal(day.kcal)}`,
              caption: days === 7 ? formatLongDate(day.date).slice(0, 2) : dayOfMonth(day.date),
              onClick: () => {
                void navigate(`/diary/${day.date}`);
              },
            }))}
          />
          <p className={styles.average}>
            {average === null
              ? 'За этот период записей нет'
              : `Среднее за дни с записями: ${formatKcal(average)}`}
          </p>
        </>
      )}
      <h2 className={styles.sectionTitle}>Привычки</h2>
      {insights.isPending && <Skeleton height={56} count={3} />}
      {insights.isError && (
        <ScreenState
          status="error"
          title="Не удалось загрузить привычки"
          description={userMessage(insights.error)}
          error={insights.error}
          action={{
            label: 'Повторить',
            onClick: () => {
              void insights.refetch();
            },
          }}
        />
      )}
      {insights.data !== undefined && <Habits insights={insights.data} />}
    </Page>
  );
}
