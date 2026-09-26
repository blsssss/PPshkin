import { Button } from '@maxhub/max-ui';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { isApiError } from '../../api/errors.ts';
import { userMessage } from '../../api/messages.ts';
import { useConsents, useGrantConsent, useProfile } from '../../api/profile.ts';
import { canCloseApp, closeApp } from '../../max/bridge.ts';
import { useOnline } from '../../shared/useOnline.ts';
import { ActionBar } from '../../shared/ui/ActionBar.tsx';
import { Notice } from '../../shared/ui/Notice.tsx';
import { ScreenState } from '../../shared/ui/ScreenState.tsx';
import { Skeleton } from '../../shared/ui/Skeleton.tsx';
import { ConsentText, OnboardingStep } from './OnboardingStep.tsx';

const OUTDATED_TEXT = 'Текст согласия обновился, прочитайте новую версию';

export function ConsentStep() {
  const navigate = useNavigate();
  const online = useOnline();
  const consents = useConsents();
  const profile = useProfile().data;
  const grant = useGrantConsent();
  const [declined, setDeclined] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const document = consents.data?.find((item) => item.kind === 'personal_data');
  const granted = profile?.consents.personalData.granted === true;

  if (declined) {
    return (
      <OnboardingStep title="Согласие" back="/onboarding">
        <ScreenState
          status="empty"
          title="Без согласия мы не можем вести дневник питания и подбирать блюда"
          action={{
            label: 'Вернуться к согласию',
            onClick: () => {
              setDeclined(false);
            },
          }}
          secondaryAction={
            canCloseApp()
              ? {
                  label: 'Закрыть',
                  onClick: () => {
                    closeApp();
                  },
                }
              : undefined
          }
        />
      </OnboardingStep>
    );
  }

  const accept = () => {
    if (document === undefined || grant.isPending) return;
    setNotice(null);
    grant.mutate(
      { kind: 'personal_data', version: document.version },
      {
        onSuccess: () => {
          void navigate('/onboarding/offers');
        },
        onError: (error) => {
          if (isApiError(error, 'consent_version_outdated')) {
            setNotice(OUTDATED_TEXT);
            void consents.refetch();
            return;
          }
          setNotice(userMessage(error));
        },
      },
    );
  };

  return (
    <OnboardingStep step={1} title={document?.title ?? 'Согласие на обработку данных'} back="/onboarding">
      {consents.isPending && <Skeleton height={18} count={8} />}
      {consents.isError && (
        <ScreenState
          status="error"
          title="Не удалось загрузить текст согласия"
          description={userMessage(consents.error)}
          error={consents.error}
          action={{
            label: 'Повторить',
            onClick: () => {
              void consents.refetch();
            },
            loading: consents.isFetching,
          }}
        />
      )}
      {document !== undefined && (
        <>
          <ConsentText text={document.text} />
          {notice !== null && <Notice tone="error">{notice}</Notice>}
          <ActionBar sends>
            {granted ? (
              <Button
                size="large"
                stretched
                onClick={() => {
                  void navigate('/onboarding/offers');
                }}
              >
                Далее
              </Button>
            ) : (
              <>
                <Button size="large" stretched loading={grant.isPending} disabled={!online} onClick={accept}>
                  {notice !== null && notice !== OUTDATED_TEXT ? 'Повторить' : 'Даю согласие'}
                </Button>
                <Button
                  size="large"
                  stretched
                  variant="secondary"
                  disabled={grant.isPending}
                  onClick={() => {
                    setDeclined(true);
                  }}
                >
                  Не сейчас
                </Button>
              </>
            )}
          </ActionBar>
        </>
      )}
    </OnboardingStep>
  );
}
