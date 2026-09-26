import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { Label } from '../../shared/ui/Label.tsx';
import { Page } from '../../shared/ui/Page.tsx';
import { ScreenHeader } from '../../shared/ui/ScreenHeader.tsx';
import styles from './Onboarding.module.css';

export const STEP_COUNT = 4;

export function OnboardingStep({
  step,
  title,
  back,
  children,
}: {
  step?: number;
  title: string;
  back?: string;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <Page>
      <ScreenHeader
        title={title}
        back={
          back === undefined
            ? undefined
            : () => {
                void navigate(back);
              }
        }
      />
      {step !== undefined && (
        <div className={styles.progress}>
          <Label tone="violet">
            Шаг {step} из {STEP_COUNT}
          </Label>
          <div className={styles.bar} aria-hidden="true">
            {Array.from({ length: STEP_COUNT }, (_, index) => (
              <span key={index} className={index < step ? styles.done : styles.todo} />
            ))}
          </div>
        </div>
      )}
      {children}
    </Page>
  );
}

export function ConsentText({ text }: { text: string }) {
  return (
    <div className={styles.document}>
      {text
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.trim())
        .filter((paragraph) => paragraph.length > 0)
        .map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
    </div>
  );
}
