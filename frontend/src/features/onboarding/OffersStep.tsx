import { Button } from '@maxhub/max-ui';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { isApiError } from '../../api/errors.ts';
import { userMessage } from '../../api/messages.ts';
import { useConsents, useGrantConsent, useProfile } from '../../api/profile.ts';
import { useOnline } from '../../shared/useOnline.ts';
import { ActionBar } from '../../shared/ui/ActionBar.tsx';
import { Notice } from '../../shared/ui/Notice.tsx';
import { ScreenState } from '../../shared/ui/ScreenState.tsx';
import { Skeleton } from '../../shared/ui/Skeleton.tsx';
import { ConsentText, OnboardingStep } from './OnboardingStep.tsx';
import styles from './Onboarding.module.css';

const NEXT = '/onboarding/goal';

export function OffersStep() {
  const navigate = useNavigate();
  const online = useOnline();
  const consents = useConsents();
  const profile = useProfile().data;
  const grant = useGrantConsent();
  const [notice, setNotice] = useState<string | null>(null);

  const document = consents.data?.find((item) => item.kind === 'personalized_offers');
  const granted = profile?.consents.personalizedOffers.granted === true;

  const accept = () => {
    if (document === undefined || grant.isPending) return;
    setNotice(null);
    grant.mutate(
      { kind: 'personalized_offers', version: document.version },
      {
        onSuccess: () => {
          void navigate(NEXT);
        },
        onError: (error) => {
          if (isApiError(error, 'consent_version_outdated')) {
            setNotice('Текст согласия обновился, прочитайте новую версию');
            void consents.refetch();
            return;
          }
          setNotice(userMessage(error));
        },
      },
    );
  };

  return (
    <OnboardingStep step={2} title={document?.title ?? 'Персональные предложения'} back="/onboarding/consent">
      {consents.isPending && <Skeleton height={18} count={5} />}
      {consents.isError && (
        <ScreenState
          status="error"
          title="Не удалось загрузить текст согласия"
          description={userMessage(consents.error)}
          action={{
            label: 'Повторить',
            onClick: () => {
              void consents.refetch();
            },
            loading: consents.isFetching,
          }}
          secondaryAction={{
            label: 'Пропустить',
            onClick: () => {
              void navigate(NEXT);
            },
          }}
        />
      )}
      {document !== undefined && (
        <>
          <ConsentText text={document.text} />
          <p className={styles.muted}>
            Подборка в мини-приложении работает и без этого согласия. Согласие нужно только для сообщений бота
            с предложениями, не чаще 2 раз в день. Отключить можно в профиле.
          </p>
          {notice !== null && <Notice tone="error">{notice}</Notice>}
          <ActionBar>
            {granted ? (
              <>
                <Notice>Предложения в чате включены</Notice>
                <Button
                  size="large"
                  stretched
                  onClick={() => {
                    void navigate(NEXT);
                  }}
                >
                  Далее
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="large"
                  stretched
                  variant="secondary"
                  loading={grant.isPending}
                  disabled={!online}
                  onClick={accept}
                >
                  Да, присылать
                </Button>
                <Button
                  size="large"
                  stretched
                  variant="secondary"
                  disabled={grant.isPending}
                  onClick={() => {
                    void navigate(NEXT);
                  }}
                >
                  Нет, спасибо
                </Button>
              </>
            )}
          </ActionBar>
        </>
      )}
    </OnboardingStep>
  );
}
