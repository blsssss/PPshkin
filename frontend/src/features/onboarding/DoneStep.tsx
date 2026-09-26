import { Button } from '@maxhub/max-ui';
import { useNavigate } from 'react-router';
import { session } from '../../api/index.ts';
import { useProfile } from '../../api/profile.ts';
import { formatKcal } from '../../shared/format.ts';
import { ActionBar } from '../../shared/ui/ActionBar.tsx';
import { GOAL_LABELS } from '../../shared/vocabulary.ts';
import { OnboardingStep } from './OnboardingStep.tsx';
import styles from './Onboarding.module.css';

export function DoneStep() {
  const navigate = useNavigate();
  const profile = useProfile().data;
  const pendingLink = session.pendingStartParam() !== null;

  const rows = [
    [
      'Цель',
      profile?.goal === null || profile?.goal === undefined ? 'Не выбрана' : GOAL_LABELS[profile.goal],
    ],
    ['Ориентир', formatKcal(profile?.kcalTarget ?? 2000)],
    ['Геопозиция', profile?.location !== null && profile?.location !== undefined ? 'Указана' : 'Не указана'],
  ] as const;

  return (
    <OnboardingStep title="Готово" back="/onboarding/location">
      <div className={styles.summary}>
        {rows.map(([label, value]) => (
          <div key={label} className={styles.summaryRow}>
            <span>{label}</span>
            <span className={styles.summaryValue}>{value}</span>
          </div>
        ))}
      </div>
      <p className={styles.muted}>Цель, ориентир и геопозицию можно изменить в профиле.</p>
      <ActionBar>
        {pendingLink ? (
          <Button
            size="large"
            stretched
            onClick={() => {
              void navigate('/', { replace: true });
            }}
          >
            Продолжить
          </Button>
        ) : (
          <>
            <Button
              size="large"
              stretched
              onClick={() => {
                void navigate('/diary?add=1', { replace: true });
              }}
            >
              Записать первый приём пищи
            </Button>
            <Button
              size="large"
              stretched
              variant="secondary"
              onClick={() => {
                void navigate('/eat', { replace: true });
              }}
            >
              Посмотреть, что поесть рядом
            </Button>
          </>
        )}
      </ActionBar>
    </OnboardingStep>
  );
}
