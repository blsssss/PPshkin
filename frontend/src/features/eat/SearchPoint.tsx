import { Button } from '@maxhub/max-ui';
import { useState } from 'react';
import { useProfile } from '../../api/profile.ts';
import { botLink } from '../../app/startParam.ts';
import { openMaxLink } from '../../max/bridge.ts';
import { setDevicePoint, useDevicePoint } from '../../shared/geo/devicePoint.ts';
import { useGeolocation, type GeoPoint } from '../../shared/geo/useGeolocation.ts';
import { Notice } from '../../shared/ui/Notice.tsx';
import { resolveSearchPoint, type PointSource } from './model.ts';
import styles from './Eat.module.css';

const LINES: Record<PointSource, string> = {
  device: 'Рядом с вами',
  saved: 'Рядом с вашим районом',
  none: 'По всему городу: геопозиция не указана',
};

const DEMO_CENTER_TEXT =
  'Вы далеко от Казани, поэтому показываем тестовые заведения в центре Казани, расстояние считаем от ул. Баумана';

export function useSearchPoint(): { source: PointSource; point: GeoPoint | null } {
  const device = useDevicePoint();
  const saved = useProfile().data?.location;
  return resolveSearchPoint(device, saved);
}

export interface Locator {
  locate: () => void;
  requesting: boolean;
  failed: boolean;
}

export function useLocator(): Locator {
  const geo = useGeolocation();
  const [failed, setFailed] = useState(false);
  return {
    locate: () => {
      setFailed(false);
      void geo.request().then((point) => {
        if (point === null) setFailed(true);
        else setDevicePoint(point);
      });
    },
    requesting: geo.status === 'requesting',
    failed,
  };
}

export function SearchPointBar({
  source,
  demoCenter,
  locator,
}: {
  source: PointSource;
  demoCenter: boolean;
  locator: Locator;
}) {
  return (
    <div className={styles.pointBar}>
      <div className={styles.pointRow}>
        <span className={styles.pointText}>{demoCenter ? DEMO_CENTER_TEXT : LINES[source]}</span>
        {source !== 'device' && (
          <Button size="small" variant="secondary" loading={locator.requesting} onClick={locator.locate}>
            {source === 'saved' ? 'Уточнить' : 'Указать'}
          </Button>
        )}
      </div>
      {locator.failed && (
        <Notice tone="error">
          Не получилось определить геопозицию. Отправьте её в чате с ботом: команда /profile, пункт обновления
          геопозиции.
          <button
            type="button"
            className={styles.inlineLink}
            onClick={() => {
              openMaxLink(botLink());
            }}
          >
            Перейти в чат с ботом
          </button>
        </Notice>
      )}
    </div>
  );
}
