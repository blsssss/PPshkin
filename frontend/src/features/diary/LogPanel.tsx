import { Button, Spinner } from '@maxhub/max-ui';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { isApiError } from '../../api/errors.ts';
import { api } from '../../api/index.ts';
import { userMessage } from '../../api/messages.ts';
import { formatKcalRange } from '../../shared/format.ts';
import { ConfirmSheet } from '../../shared/ui/ConfirmSheet.tsx';
import { Notice } from '../../shared/ui/Notice.tsx';
import { useToast } from '../../shared/ui/Toast.tsx';
import { UNAVAILABLE_TEXTS } from './logging.ts';
import { useRefreshDiary, type Meal, type MealCandidate } from './queries.ts';
import type { LoggerState } from './useMealLogger.ts';
import styles from './Diary.module.css';

function macros(meal: {
  proteinG: number | null;
  fatG: number | null;
  carbsG: number | null;
}): string | null {
  if (meal.proteinG === null && meal.fatG === null && meal.carbsG === null) return null;
  const value = (grams: number | null) => (grams === null ? '-' : String(grams).replace('.', ','));
  return `Б ${value(meal.proteinG)} г, Ж ${value(meal.fatG)} г, У ${value(meal.carbsG)} г`;
}

function LoggedMeal({ meal, date }: { meal: Meal; date: string }) {
  const navigate = useNavigate();
  const toast = useToast();
  const refresh = useRefreshDiary();
  const [confirm, setConfirm] = useState(false);
  const [removed, setRemoved] = useState(false);
  if (removed) return null;
  const details = macros(meal);
  return (
    <li className={styles.logged}>
      <p className={styles.loggedTitle}>{meal.title}</p>
      <p className={styles.loggedKcal}>{formatKcalRange(meal.kcalMin, meal.kcalMax)}</p>
      {details !== null && <p className={styles.muted}>{details}</p>}
      <div className={styles.inlineActions}>
        <Button
          size="small"
          variant="secondary"
          onClick={() => {
            void navigate(`/diary/meals/${meal.id}?date=${date}`);
          }}
        >
          Исправить
        </Button>
        <Button
          size="small"
          variant="secondary"
          onClick={() => {
            setConfirm(true);
          }}
        >
          Удалить
        </Button>
      </div>
      <ConfirmSheet
        open={confirm}
        title="Удалить запись?"
        description={meal.title}
        confirmLabel="Удалить"
        destructive
        onCancel={() => {
          setConfirm(false);
        }}
        onConfirm={async () => {
          const result = await api
            .DELETE('/api/v1/diary/meals/{id}', { params: { path: { id: meal.id } } })
            .then(
              () => null,
              (error: unknown) => error,
            );
          setConfirm(false);
          const gone = isApiError(result, 'meal_not_found');
          if (result !== null && !gone) {
            toast.show(userMessage(result), { tone: 'error' });
            return;
          }
          setRemoved(true);
          toast.show(gone ? 'Запись уже удалена' : 'Запись удалена');
          await refresh();
        }}
      />
    </li>
  );
}

export function LogPanel({
  state,
  onClose,
  onDescribe,
  onPhotoAgain,
  onRetry,
  onCandidate,
}: {
  state: LoggerState;
  onClose: () => void;
  onDescribe: () => void;
  onPhotoAgain: () => void;
  onRetry: () => void;
  onCandidate: (candidate: MealCandidate | null) => void;
}) {
  const navigate = useNavigate();
  if (state.kind === 'idle') return null;

  if (state.kind === 'working') {
    return (
      <section className={styles.panel} aria-live="polite" aria-busy="true">
        {state.preview !== null && <img className={styles.preview} src={state.preview} alt="Фото еды" />}
        <div className={styles.working}>
          <Spinner size={24} appearance="themed" />
          <span>
            {state.source === 'photo'
              ? state.slow
                ? 'Распознавание занимает больше обычного'
                : 'Распознаём блюдо, обычно 5-10 секунд'
              : 'Распознаём описание, обычно 2-3 секунды'}
          </span>
        </div>
        {state.slow && state.source === 'photo' && (
          <Button size="medium" variant="secondary" stretched onClick={onDescribe}>
            Описать словами
          </Button>
        )}
      </section>
    );
  }

  if (state.kind === 'error') {
    return (
      <section className={styles.panel} aria-live="polite">
        <Notice tone="error">{state.message}</Notice>
        <div className={styles.panelActions}>
          {!state.lost && state.source === 'photo' && (
            <Button size="medium" stretched onClick={onRetry}>
              Повторить
            </Button>
          )}
          <Button size="medium" variant="secondary" stretched onClick={onDescribe}>
            Описать словами
          </Button>
          <Button size="medium" variant="secondary" stretched onClick={onClose}>
            Закрыть
          </Button>
        </div>
      </section>
    );
  }

  const { result } = state;
  const manual = () => {
    onCandidate(null);
  };

  return (
    <section className={styles.panel} aria-live="polite">
      {result.status === 'logged' && (
        <>
          <h2 className={styles.panelTitle}>Записали</h2>
          <ul className={styles.loggedList}>
            {result.meals.map((meal) => (
              <LoggedMeal key={meal.id} meal={meal} date={result.day.date} />
            ))}
          </ul>
          <p className={styles.muted}>Как оценили: {result.basis}</p>
          <div className={styles.panelActions}>
            <Button size="medium" stretched onClick={onClose}>
              Верно
            </Button>
            <Button
              size="medium"
              variant="secondary"
              stretched
              onClick={() => {
                void navigate('/eat');
              }}
            >
              Что поесть сейчас?
            </Button>
          </div>
        </>
      )}
      {result.status === 'uncertain' && (
        <>
          <h2 className={styles.panelTitle}>Не уверены, что это. Выберите подходящее</h2>
          <ul className={styles.candidates}>
            {result.candidates.map((candidate, index) => (
              <li key={`${candidate.title}-${index}`}>
                <button
                  type="button"
                  className={styles.candidate}
                  onClick={() => {
                    onCandidate(candidate);
                  }}
                >
                  <span>{candidate.title}</span>
                  <span className={styles.mealKcal}>
                    {formatKcalRange(candidate.kcalMin, candidate.kcalMax)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <p className={styles.muted}>{result.basis}</p>
          <div className={styles.panelActions}>
            <Button size="medium" variant="secondary" stretched onClick={manual}>
              Ничего не подходит
            </Button>
          </div>
        </>
      )}
      {result.status === 'not_food' && (
        <>
          <h2 className={styles.panelTitle}>На фото не нашли еду</h2>
          <p className={styles.muted}>{result.basis}</p>
          <div className={styles.panelActions}>
            <Button size="medium" stretched onClick={onPhotoAgain}>
              Сфотографировать ещё раз
            </Button>
            <Button size="medium" variant="secondary" stretched onClick={onDescribe}>
              Описать словами
            </Button>
          </div>
        </>
      )}
      {result.status === 'unavailable' && (
        <>
          <Notice tone="error">{UNAVAILABLE_TEXTS[result.reason]}</Notice>
          <div className={styles.panelActions}>
            <Button size="medium" stretched onClick={onDescribe}>
              Описать словами
            </Button>
            <Button size="medium" variant="secondary" stretched onClick={manual}>
              Ввести вручную
            </Button>
            {state.source === 'photo' && (
              <Button size="medium" variant="secondary" stretched onClick={onRetry}>
                Повторить
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
