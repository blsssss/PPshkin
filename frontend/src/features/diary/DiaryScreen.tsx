import { Button } from '@maxhub/max-ui';
import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { userMessage } from '../../api/messages.ts';
import { useProfile } from '../../api/profile.ts';
import { haptic } from '../../max/bridge.ts';
import { formatKcal } from '../../shared/format.ts';
import { useOnline } from '../../shared/useOnline.ts';
import { BarChart } from '../../shared/ui/BarChart.tsx';
import { Notice } from '../../shared/ui/Notice.tsx';
import { Page } from '../../shared/ui/Page.tsx';
import { PixelIcon } from '../../shared/ui/PixelIcon.tsx';
import { ScreenHeader } from '../../shared/ui/ScreenHeader.tsx';
import { ScreenState } from '../../shared/ui/ScreenState.tsx';
import { Skeleton } from '../../shared/ui/Skeleton.tsx';
import { dayTitle, daysBetween, formatLongDate, isIsoDate, shiftDate, weekdayShort } from './dates.ts';
import { LogPanel } from './LogPanel.tsx';
import { PhotoSheet, TextSheet } from './LogSheets.tsx';
import { MAX_PAST_DAYS } from './mealForm.ts';
import { MealList } from './MealList.tsx';
import { DaySummary } from './DaySummary.tsx';
import { useDiaryDay, useSummary, useToday, type MealCandidate } from './queries.ts';
import { useMealLogger } from './useMealLogger.ts';
import styles from './Diary.module.css';

function useRefetchOnReturn(refetch: () => unknown): void {
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') refetch();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refetch]);
}

function WeekCard() {
  const summary = useSummary(7);
  const target = useProfile().data?.kcalTarget;
  return (
    <Link className={styles.weekCard} to="/insights">
      <span className={styles.weekTitle}>Неделя</span>
      {summary.data !== undefined ? (
        <BarChart
          compact
          height={56}
          title="Калории за 7 дней"
          target={target}
          bars={summary.data.map((day) => ({
            key: day.date,
            value: day.kcal,
            label: `${formatLongDate(day.date)}: ${formatKcal(day.kcal)}`,
            caption: weekdayShort(day.date),
          }))}
        />
      ) : (
        <Skeleton height={56} />
      )}
      <span className={styles.weekLink}>Привычки и график</span>
    </Link>
  );
}

export function DiaryScreen() {
  const navigate = useNavigate();
  const { date: param } = useParams();
  const [params, setParams] = useSearchParams();
  const online = useOnline();
  const profile = useProfile().data;
  const today = useToday();
  const day = useDiaryDay(param ?? null);
  const logger = useMealLogger();
  const [photoOpen, setPhotoOpen] = useState(false);
  const [textOpen, setTextOpen] = useState(params.get('add') === 'text');
  const [chooserOpen, setChooserOpen] = useState(params.get('add') === '1');
  const refetchDay = day.refetch;
  useRefetchOnReturn(refetchDay);

  const todayDate = today.data?.date;
  const date = day.data?.date ?? param ?? todayDate;

  if (param !== undefined && !isIsoDate(param)) {
    return (
      <Page>
        <ScreenHeader title="Дневник" back="/diary" />
        <ScreenState
          status="empty"
          title="Такой даты нет"
          action={{
            label: 'К сегодняшнему дню',
            onClick: () => {
              void navigate('/diary');
            },
          }}
        />
      </Page>
    );
  }

  if (param !== undefined && todayDate !== undefined && daysBetween(param, todayDate) <= 0) {
    return <Navigate to="/diary" replace />;
  }

  const isToday = date !== undefined && todayDate !== undefined && date === todayDate;
  const age = date !== undefined && todayDate !== undefined ? daysBetween(date, todayDate) : 0;
  const canAdd = age < MAX_PAST_DAYS;
  const title = date !== undefined && todayDate !== undefined ? dayTitle(date, todayDate) : 'Дневник';

  const goTo = (next: string) => {
    if (todayDate !== undefined && next === todayDate) void navigate('/diary');
    else void navigate(`/diary/${next}`);
  };

  const closeAdd = () => {
    setChooserOpen(false);
    if (params.has('add')) setParams({}, { replace: true });
  };

  const manual = (candidate: MealCandidate | null) => {
    logger.reset();
    const target = isToday || date === undefined ? '/diary/meals/new' : `/diary/meals/new?date=${date}`;
    void navigate(target, { state: candidate === null ? null : { candidate } });
  };

  return (
    <Page>
      <ScreenHeader title={title} back={param === undefined ? undefined : '/diary'} />
      {date !== undefined && todayDate !== undefined && (
        <nav className={styles.dateNav} aria-label="Выбор дня">
          <button
            type="button"
            className={styles.dateArrow}
            aria-label="Предыдущий день"
            onClick={() => {
              goTo(shiftDate(date, -1));
            }}
          >
            <PixelIcon name="back" size={20} />
          </button>
          <input
            className={styles.dateInput}
            type="date"
            aria-label="Дата"
            value={date}
            max={todayDate}
            onChange={(event) => {
              const value = event.target.value;
              if (isIsoDate(value) && daysBetween(value, todayDate) >= 0) goTo(value);
            }}
          />
          <button
            type="button"
            className={`${styles.dateArrow} ${styles.forward}`}
            aria-label="Следующий день"
            disabled={isToday || age <= 0}
            onClick={() => {
              goTo(shiftDate(date, 1));
            }}
          >
            <PixelIcon name="back" size={20} />
          </button>
        </nav>
      )}

      {profile?.goal === null && (
        <Notice>
          <Link to="/onboarding/goal" className={styles.bannerLink}>
            Укажите цель и дневной ориентир
          </Link>
        </Notice>
      )}

      {day.isPending && (
        <div className={styles.loading}>
          <Skeleton height={132} />
          <Skeleton height={48} count={3} />
        </div>
      )}
      {day.isError && (
        <ScreenState
          status="error"
          title="Не удалось загрузить день"
          description={userMessage(day.error)}
          action={{
            label: 'Повторить',
            onClick: () => {
              void day.refetch();
            },
            loading: day.isFetching,
          }}
        />
      )}

      {day.data !== undefined && (
        <>
          <DaySummary day={day.data} />
          <LogPanel
            state={logger.state}
            date={day.data.date}
            onClose={logger.reset}
            onDescribe={() => {
              logger.reset();
              setTextOpen(true);
            }}
            onPhotoAgain={() => {
              logger.reset();
              setPhotoOpen(true);
            }}
            onRetry={() => {
              void logger.retryPhoto();
            }}
            onCandidate={manual}
          />
          {canAdd ? (
            <div className={styles.addActions}>
              {isToday && (
                <>
                  <Button
                    size="large"
                    stretched
                    disabled={!online || logger.state.kind === 'working'}
                    onClick={() => {
                      haptic.impact('light');
                      setPhotoOpen(true);
                    }}
                  >
                    Сфотографировать еду
                  </Button>
                  <Button
                    size="large"
                    variant="secondary"
                    stretched
                    disabled={!online || logger.state.kind === 'working'}
                    onClick={() => {
                      setTextOpen(true);
                    }}
                  >
                    Описать словами
                  </Button>
                </>
              )}
              <Button
                size="large"
                variant="secondary"
                stretched
                onClick={() => {
                  manual(null);
                }}
              >
                Ввести вручную
              </Button>
            </div>
          ) : (
            <p className={styles.muted}>Добавлять записи можно за последние 7 дней.</p>
          )}
          {day.data.meals.length === 0 ? (
            <p className={styles.empty}>За этот день записей нет</p>
          ) : (
            <MealList meals={day.data.meals} date={day.data.date} timeZone={day.data.timezone} />
          )}
          <Button
            size="large"
            variant="secondary"
            stretched
            onClick={() => {
              void navigate('/eat');
            }}
          >
            Что поесть сейчас?
          </Button>
          <WeekCard />
          <p className={styles.disclaimer}>Калорийность приблизительная, это не медицинская рекомендация.</p>
        </>
      )}

      <PhotoSheet
        open={photoOpen || (chooserOpen && isToday)}
        title={chooserOpen ? 'Как записать приём пищи' : 'Фото еды'}
        extra={
          chooserOpen ? (
            <>
              <Button
                size="large"
                variant="secondary"
                stretched
                onClick={() => {
                  closeAdd();
                  setTextOpen(true);
                }}
              >
                Описать словами
              </Button>
              <Button
                size="large"
                variant="secondary"
                stretched
                onClick={() => {
                  closeAdd();
                  manual(null);
                }}
              >
                Ввести вручную
              </Button>
            </>
          ) : undefined
        }
        onClose={() => {
          setPhotoOpen(false);
          closeAdd();
        }}
        onFile={(file) => {
          setPhotoOpen(false);
          closeAdd();
          void logger.logFile(file);
        }}
      />
      <TextSheet
        open={textOpen}
        onClose={() => {
          setTextOpen(false);
          closeAdd();
        }}
        onSubmit={(description) => {
          setTextOpen(false);
          closeAdd();
          void logger.logText(description);
        }}
      />
    </Page>
  );
}
