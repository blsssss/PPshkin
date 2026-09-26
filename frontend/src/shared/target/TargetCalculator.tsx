import { Button } from '@maxhub/max-ui';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { unwrap } from '../../api/client.ts';
import { api } from '../../api/index.ts';
import { userMessage } from '../../api/messages.ts';
import { formatKcal } from '../format.ts';
import { useOnline } from '../useOnline.ts';
import { ChoiceList } from '../ui/ChoiceList.tsx';
import { Field } from '../ui/Field.tsx';
import { Notice } from '../ui/Notice.tsx';
import { ACTIVITY_LABELS, SEX_LABELS, type Activity, type Goal, type Sex } from '../vocabulary.ts';
import { BODY_LIMITS, EMPTY_BODY_FORM, validateBody, type BodyField, type BodyForm } from './body.ts';
import styles from './TargetCalculator.module.css';

const SEX_OPTIONS = (Object.keys(SEX_LABELS) as Sex[]).map((value) => ({ value, label: SEX_LABELS[value] }));
const ACTIVITY_OPTIONS = (Object.keys(ACTIVITY_LABELS) as Activity[]).map((value) => ({
  value,
  label: ACTIVITY_LABELS[value],
}));

export function TargetCalculator({ goal, onUse }: { goal: Goal | null; onUse: (kcal: number) => void }) {
  const [form, setForm] = useState<BodyForm>(EMPTY_BODY_FORM);
  const [errors, setErrors] = useState<Partial<Record<BodyField, string>>>({});
  const online = useOnline();
  const estimate = useMutation({
    gcTime: 0,
    mutationFn: async (body: NonNullable<ReturnType<typeof validateBody>['values']>) =>
      unwrap(await api.POST('/api/v1/me/target/estimate', { body })),
  });

  const { reset } = estimate;
  useEffect(() => {
    reset();
  }, [goal, reset]);

  const update = (patch: Partial<BodyForm>) => {
    setForm((current) => ({ ...current, ...patch }));
    estimate.reset();
  };

  const submit = () => {
    const result = validateBody(form, goal);
    setErrors(result.errors);
    if (result.values !== null) estimate.mutate(result.values);
  };

  const result = estimate.data;

  return (
    <section className={styles.calculator} aria-label="Расчёт ориентира">
      <ChoiceList
        legend="Пол"
        options={SEX_OPTIONS}
        value={form.sex}
        onChange={(sex) => {
          update({ sex });
        }}
        error={errors.sex}
      />
      <div className={styles.row}>
        <Field
          label="Возраст, лет"
          inputMode="numeric"
          value={form.ageYears}
          onChange={(event) => {
            update({ ageYears: event.target.value });
          }}
          hint={BODY_LIMITS.ageYears.hint}
          error={errors.ageYears}
        />
        <Field
          label="Рост, см"
          inputMode="numeric"
          value={form.heightCm}
          onChange={(event) => {
            update({ heightCm: event.target.value });
          }}
          hint={BODY_LIMITS.heightCm.hint}
          error={errors.heightCm}
        />
        <Field
          label="Вес, кг"
          inputMode="decimal"
          value={form.weightKg}
          onChange={(event) => {
            update({ weightKg: event.target.value });
          }}
          hint={BODY_LIMITS.weightKg.hint}
          error={errors.weightKg}
        />
      </div>
      <ChoiceList
        legend="Активность"
        options={ACTIVITY_OPTIONS}
        value={form.activity}
        onChange={(activity) => {
          update({ activity });
        }}
        error={errors.activity}
      />
      {errors.goal !== undefined && <Notice tone="error">{errors.goal}</Notice>}
      {estimate.isError && <Notice tone="error">{userMessage(estimate.error)}</Notice>}
      <Button
        size="large"
        variant="secondary"
        stretched
        loading={estimate.isPending}
        disabled={!online}
        onClick={submit}
      >
        Рассчитать
      </Button>
      {result !== undefined && (
        <div className={styles.result} aria-live="polite">
          <p>Базовый обмен: {formatKcal(result.bmrKcal)}</p>
          <p>С учётом активности: {formatKcal(result.maintenanceKcal)}</p>
          <p className={styles.target}>Ориентир для цели: {formatKcal(result.kcalTarget)}</p>
          <p className={styles.note}>Оценка по формуле Миффлина-Сан Жеора, это не медицинская рекомендация</p>
          <Button
            size="large"
            stretched
            onClick={() => {
              onUse(result.kcalTarget);
            }}
          >
            Использовать {formatKcal(result.kcalTarget)}
          </Button>
        </div>
      )}
      <p className={styles.note}>Пол, возраст, рост и вес нужны только для расчёта и не сохраняются.</p>
    </section>
  );
}
