import { Button, Switch } from '@maxhub/max-ui';
import { useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { unwrap } from '../../api/client.ts';
import { isApiError } from '../../api/errors.ts';
import { api } from '../../api/index.ts';
import { userMessage } from '../../api/messages.ts';
import { haptic } from '../../max/bridge.ts';
import { useUnsavedChanges } from '../../shared/useUnsavedChanges.tsx';
import { useOnline } from '../../shared/useOnline.ts';
import { ActionBar } from '../../shared/ui/ActionBar.tsx';
import { Chip, ChipRow } from '../../shared/ui/Chip.tsx';
import { ConfirmSheet } from '../../shared/ui/ConfirmSheet.tsx';
import { Field } from '../../shared/ui/Field.tsx';
import { Notice } from '../../shared/ui/Notice.tsx';
import { Page } from '../../shared/ui/Page.tsx';
import { ScreenHeader } from '../../shared/ui/ScreenHeader.tsx';
import { ScreenState } from '../../shared/ui/ScreenState.tsx';
import { Skeleton } from '../../shared/ui/Skeleton.tsx';
import { useToast } from '../../shared/ui/Toast.tsx';
import { useProfile } from '../../api/profile.ts';
import { TAG_LABELS, type Tag } from '../../shared/vocabulary.ts';
import { isIsoDate } from './dates.ts';
import {
  emptyForm,
  formFromCandidate,
  formFromMeal,
  mapFieldErrors,
  MAX_MEAL_TAGS,
  toCreateInput,
  toPatchInput,
  validateMeal,
  type MealField,
  type MealFormState,
} from './mealForm.ts';
import { useDiaryDay, useRefreshDiary, type Meal, type MealCandidate } from './queries.ts';
import styles from './Diary.module.css';
import { useLeave } from '../../shared/appHistory.ts';

const TAGS = Object.keys(TAG_LABELS) as Tag[];

function MealForm({
  meal,
  date,
  candidate,
  timeZone,
}: {
  meal: Meal | null;
  date: string | null;
  candidate: MealCandidate | null;
  timeZone: string;
}) {
  const leaveTo = useLeave();
  const toast = useToast();
  const online = useOnline();
  const refresh = useRefreshDiary();
  const initial = useMemo(() => {
    const now = new Date();
    if (meal !== null) return formFromMeal(meal, timeZone);
    if (candidate !== null) return formFromCandidate(candidate, date, now, timeZone);
    return emptyForm(date, now, timeZone);
  }, [meal, candidate, date, timeZone]);
  const [form, setForm] = useState<MealFormState>(initial);
  const [errors, setErrors] = useState<Partial<Record<MealField, string>>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showTags, setShowTags] = useState(initial.tags.length > 0);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const back = date === null ? '/diary' : `/diary/${date}`;

  const { prompt, release } = useUnsavedChanges(dirty);

  const update = (patch: Partial<MealFormState>) => {
    setForm((current) => ({ ...current, ...patch }));
    setErrors((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !(key in patch))));
  };

  const leave = () => {
    release();
    leaveTo(back);
  };

  const save = async () => {
    if (saving) return;
    const result = validateMeal(form, new Date(), timeZone, meal?.eatenAt);
    setErrors(result.errors);
    if (result.meal === null) return;
    setNotice(null);
    setSaving(true);
    try {
      if (meal === null) {
        unwrap(await api.POST('/api/v1/diary/meals', { body: toCreateInput(result.meal) }));
        haptic.success();
        toast.show('Запись добавлена');
      } else {
        const patch = toPatchInput(result.meal, meal);
        if (Object.keys(patch).length > 0) {
          unwrap(
            await api.PATCH('/api/v1/diary/meals/{id}', { params: { path: { id: meal.id } }, body: patch }),
          );
        }
        toast.show('Запись сохранена');
      }
      await refresh();
      leave();
    } catch (error) {
      haptic.error();
      if (isApiError(error, 'eaten_at_out_of_range')) {
        setErrors({ eatenAt: 'Можно указать время за последние 7 дней' });
      } else if (isApiError(error, 'meal_not_found')) {
        toast.show('Запись уже удалена');
        await refresh();
        leave();
      } else if (isApiError(error, 'validation_failed') && Object.keys(error.fieldErrors).length > 0) {
        setErrors(mapFieldErrors(error.fieldErrors, form.range));
      } else {
        setNotice(userMessage(error));
      }
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (meal === null) return;
    try {
      await api.DELETE('/api/v1/diary/meals/{id}', { params: { path: { id: meal.id } } });
      toast.show('Запись удалена');
    } catch (error) {
      if (!isApiError(error, 'meal_not_found')) {
        haptic.error();
        setConfirmDelete(false);
        setNotice(userMessage(error));
        return;
      }
      toast.show('Запись уже удалена');
    }
    setConfirmDelete(false);
    await refresh();
    leave();
  };

  return (
    <>
      <Field
        label="Название"
        value={form.title}
        maxLength={200}
        onChange={(event) => {
          update({ title: event.target.value });
        }}
        error={errors.title}
      />
      <label className={styles.switchRow}>
        <span>Диапазон калорийности</span>
        <Switch
          checked={form.range}
          onChange={(event) => {
            update({ range: event.target.checked });
          }}
        />
      </label>
      {form.range ? (
        <div className={styles.pair}>
          <Field
            label="От, ккал"
            inputMode="numeric"
            value={form.kcalMin}
            onChange={(event) => {
              update({ kcalMin: event.target.value });
            }}
            error={errors.kcalMin}
          />
          <Field
            label="До, ккал"
            inputMode="numeric"
            value={form.kcalMax}
            onChange={(event) => {
              update({ kcalMax: event.target.value });
            }}
            error={errors.kcalMax}
          />
        </div>
      ) : (
        <Field
          label="Калорийность, ккал"
          inputMode="numeric"
          value={form.kcal}
          onChange={(event) => {
            update({ kcal: event.target.value });
          }}
          error={errors.kcal}
        />
      )}
      <div className={styles.triple}>
        <Field
          label="Белки, г"
          inputMode="decimal"
          value={form.proteinG}
          onChange={(event) => {
            update({ proteinG: event.target.value });
          }}
          error={errors.proteinG}
        />
        <Field
          label="Жиры, г"
          inputMode="decimal"
          value={form.fatG}
          onChange={(event) => {
            update({ fatG: event.target.value });
          }}
          error={errors.fatG}
        />
        <Field
          label="Углеводы, г"
          inputMode="decimal"
          value={form.carbsG}
          onChange={(event) => {
            update({ carbsG: event.target.value });
          }}
          error={errors.carbsG}
        />
      </div>
      <Field
        label="Когда"
        type="datetime-local"
        value={form.eatenAt}
        onChange={(event) => {
          update({ eatenAt: event.target.value });
        }}
        hint="За последние 7 дней"
        error={errors.eatenAt}
      />
      <Button
        size="medium"
        variant="ghost"
        aria-expanded={showTags}
        onClick={() => {
          setShowTags((open) => !open);
        }}
      >
        {showTags ? 'Скрыть теги' : `Теги${form.tags.length > 0 ? `: ${form.tags.length}` : ''}`}
      </Button>
      {showTags && (
        <ChipRow label="Теги блюда">
          {TAGS.map((tag) => (
            <Chip
              key={tag}
              pressed={form.tags.includes(tag)}
              disabled={!form.tags.includes(tag) && form.tags.length >= MAX_MEAL_TAGS}
              onClick={() => {
                update({
                  tags: form.tags.includes(tag)
                    ? form.tags.filter((item) => item !== tag)
                    : [...form.tags, tag],
                });
              }}
            >
              {TAG_LABELS[tag]}
            </Chip>
          ))}
        </ChipRow>
      )}
      {errors.tags !== undefined && <p className={styles.fieldError}>{errors.tags}</p>}
      {notice !== null && <Notice tone="error">{notice}</Notice>}
      <ActionBar sends>
        <Button
          size="large"
          stretched
          loading={saving}
          disabled={!online}
          onClick={() => {
            void save();
          }}
        >
          {meal === null ? 'Добавить запись' : 'Сохранить'}
        </Button>
        {meal !== null && (
          <Button
            size="large"
            variant="secondary"
            stretched
            disabled={saving}
            onClick={() => {
              setConfirmDelete(true);
            }}
          >
            Удалить запись
          </Button>
        )}
      </ActionBar>
      <ConfirmSheet
        open={confirmDelete}
        title="Удалить запись?"
        description={meal?.title}
        confirmLabel="Удалить"
        destructive
        onCancel={() => {
          setConfirmDelete(false);
        }}
        onConfirm={remove}
      />
      {prompt}
    </>
  );
}

function deviceZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function NewMealScreen() {
  const [params] = useSearchParams();
  const timeZone = useProfile().data?.timezone ?? deviceZone();
  const location = useLocation();
  const raw = params.get('date');
  const date = raw !== null && isIsoDate(raw) ? raw : null;
  const state: unknown = location.state;
  const candidate =
    typeof state === 'object' && state !== null && 'candidate' in state
      ? (state.candidate as MealCandidate)
      : null;
  return (
    <Page>
      <ScreenHeader title="Новая запись" back={date === null ? '/diary' : `/diary/${date}`} />
      <MealForm meal={null} date={date} candidate={candidate} timeZone={timeZone} />
    </Page>
  );
}

export function EditMealScreen() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [params] = useSearchParams();
  const raw = params.get('date');
  const date = raw !== null && isIsoDate(raw) ? raw : null;
  const day = useDiaryDay(date);
  const meal = day.data?.meals.find((item) => String(item.id) === id) ?? null;
  const back = date === null ? '/diary' : `/diary/${date}`;
  return (
    <Page>
      <ScreenHeader title="Запись" back={back} />
      {day.isPending && <Skeleton height={48} count={5} />}
      {day.isError && (
        <ScreenState
          status="error"
          title="Не удалось загрузить запись"
          description={userMessage(day.error)}
          error={day.error}
          action={{
            label: 'Повторить',
            onClick: () => {
              void day.refetch();
            },
          }}
        />
      )}
      {day.data !== undefined && meal === null && (
        <ScreenState
          status="empty"
          title="Запись не найдена, возможно, её уже удалили"
          action={{
            label: 'К дневнику',
            onClick: () => {
              void navigate(back);
            },
          }}
        />
      )}
      {meal !== null && (
        <MealForm
          key={meal.id}
          meal={meal}
          date={day.data?.date ?? date}
          candidate={null}
          timeZone={day.data?.timezone ?? deviceZone()}
        />
      )}
    </Page>
  );
}
