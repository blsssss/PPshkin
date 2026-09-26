import { Button } from '@maxhub/max-ui';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { isApiError } from '../../api/errors.ts';
import { userMessage } from '../../api/messages.ts';
import { useProfile, useUpdateProfile } from '../../api/profile.ts';
import { validateKcalTarget } from '../../shared/target/body.ts';
import { KcalTargetPicker } from '../../shared/target/KcalTargetPicker.tsx';
import { TargetCalculator } from '../../shared/target/TargetCalculator.tsx';
import { useOnline } from '../../shared/useOnline.ts';
import { ActionBar } from '../../shared/ui/ActionBar.tsx';
import { ChoiceList } from '../../shared/ui/ChoiceList.tsx';
import { Notice } from '../../shared/ui/Notice.tsx';
import { GOAL_LABELS, GOALS, type Goal } from '../../shared/vocabulary.ts';
import { OnboardingStep } from './OnboardingStep.tsx';
import styles from './Onboarding.module.css';

const NEXT = '/onboarding/location';
const GOAL_OPTIONS = GOALS.map((value) => ({ value, label: GOAL_LABELS[value] }));

export function GoalStep() {
  const navigate = useNavigate();
  const online = useOnline();
  const profile = useProfile().data;
  const update = useUpdateProfile();
  const [goal, setGoal] = useState<Goal | null>(profile?.goal ?? null);
  const [kcal, setKcal] = useState(String(profile?.kcalTarget ?? 2000));
  const [calculatorOpen, setCalculatorOpen] = useState(false);
  const [kcalError, setKcalError] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(null);

  const save = () => {
    const target = validateKcalTarget(kcal);
    if (typeof target === 'string') {
      setKcalError(target);
      return;
    }
    setKcalError(undefined);
    setNotice(null);
    update.mutate(
      { kcalTarget: target, goal },
      {
        onSuccess: () => {
          void navigate(NEXT);
        },
        onError: (error) => {
          if (isApiError(error, 'validation_failed') && error.fieldErrors.kcalTarget !== undefined) {
            setKcalError(error.fieldErrors.kcalTarget);
            return;
          }
          setNotice(userMessage(error));
        },
      },
    );
  };

  return (
    <OnboardingStep step={3} title="Цель и ориентир" back="/onboarding/offers">
      <ChoiceList
        legend="Цель"
        options={GOAL_OPTIONS}
        value={goal}
        onChange={(value) => {
          setGoal(value);
        }}
      />
      <h2 className={styles.section}>Дневной ориентир</h2>
      <KcalTargetPicker
        value={kcal}
        onChange={(value) => {
          setKcal(value);
          setKcalError(undefined);
        }}
        error={kcalError}
      />
      <Button
        size="medium"
        variant="ghost"
        aria-expanded={calculatorOpen}
        onClick={() => {
          setCalculatorOpen((open) => !open);
        }}
      >
        {calculatorOpen ? 'Скрыть расчёт' : 'Рассчитать по параметрам'}
      </Button>
      {calculatorOpen && (
        <TargetCalculator
          goal={goal}
          onUse={(value) => {
            setKcal(String(value));
            setKcalError(undefined);
          }}
        />
      )}
      {notice !== null && <Notice tone="error">{notice}</Notice>}
      <ActionBar>
        <Button size="large" stretched loading={update.isPending} disabled={!online} onClick={save}>
          {notice !== null ? 'Повторить' : 'Сохранить'}
        </Button>
        <Button
          size="large"
          stretched
          variant="secondary"
          disabled={update.isPending}
          onClick={() => {
            void navigate(NEXT);
          }}
        >
          Пропустить
        </Button>
      </ActionBar>
    </OnboardingStep>
  );
}
