import { Button } from '@maxhub/max-ui';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { unwrap } from '../../api/client.ts';
import { api } from '../../api/index.ts';
import { userMessage } from '../../api/messages.ts';
import { useProfile } from '../../api/profile.ts';
import { botLink } from '../../app/startParam.ts';
import { openMaxLink } from '../../max/bridge.ts';
import { setDevicePoint } from '../../shared/geo/devicePoint.ts';
import { geolocationSupported, useGeolocation } from '../../shared/geo/useGeolocation.ts';
import { useOnline } from '../../shared/useOnline.ts';
import { ActionBar } from '../../shared/ui/ActionBar.tsx';
import { Notice } from '../../shared/ui/Notice.tsx';
import { OnboardingStep } from './OnboardingStep.tsx';
import styles from './Onboarding.module.css';

const NEXT = '/onboarding/done';

export function LocationStep() {
  const navigate = useNavigate();
  const online = useOnline();
  const profile = useProfile();
  const geo = useGeolocation();
  const [fallback, setFallback] = useState(!geolocationSupported());
  const save = useMutation({
    mutationFn: async (point: { lat: number; lon: number }) =>
      unwrap(await api.PUT('/api/v1/me/location', { body: point })),
    onSuccess: async () => {
      await profile.refetch();
      void navigate(NEXT);
    },
  });

  const hasLocation = profile.data?.location !== null && profile.data?.location !== undefined;

  useEffect(() => {
    if (!fallback) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') void profile.refetch();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fallback, profile]);

  const allow = async () => {
    if (save.isError) {
      save.mutate(save.variables);
      return;
    }
    const point = await geo.request();
    if (point === null) {
      setFallback(true);
      return;
    }
    setDevicePoint(point);
    save.mutate(point);
  };

  const skip = (
    <Button
      size="large"
      stretched
      variant="secondary"
      disabled={save.isPending}
      onClick={() => {
        void navigate(NEXT);
      }}
    >
      Пропустить
    </Button>
  );

  return (
    <OnboardingStep step={4} title="Геопозиция" back="/onboarding/goal">
      <p className={styles.lead}>
        Чтобы подбирать заведения рядом, разрешите доступ к геопозиции. На сервере храним только
        приблизительное место с точностью около 1 км.
      </p>
      {hasLocation && fallback && <Notice>Геопозиция получена из чата с ботом</Notice>}
      {!hasLocation && fallback && (
        <Notice tone="error">
          Не получилось определить геопозицию. Отправьте её в чате с ботом: команда /profile, пункт обновления
          геопозиции.
        </Notice>
      )}
      {save.isError && <Notice tone="error">{userMessage(save.error)}</Notice>}
      <ActionBar sends>
        {hasLocation && fallback ? (
          <Button
            size="large"
            stretched
            onClick={() => {
              void navigate(NEXT);
            }}
          >
            Далее
          </Button>
        ) : fallback ? (
          <Button
            size="large"
            stretched
            onClick={() => {
              openMaxLink(botLink());
            }}
          >
            Перейти в чат с ботом
          </Button>
        ) : (
          <Button
            size="large"
            stretched
            loading={geo.status === 'requesting' || save.isPending}
            disabled={!online}
            onClick={() => {
              void allow();
            }}
          >
            {save.isError ? 'Повторить' : 'Разрешить'}
          </Button>
        )}
        {skip}
      </ActionBar>
    </OnboardingStep>
  );
}
