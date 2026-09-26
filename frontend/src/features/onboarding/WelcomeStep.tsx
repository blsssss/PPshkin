import { Button } from '@maxhub/max-ui';
import { useNavigate } from 'react-router';
import { useProfile } from '../../api/profile.ts';
import { ActionBar } from '../../shared/ui/ActionBar.tsx';
import { Page } from '../../shared/ui/Page.tsx';
import { PixelSteps } from '../../shared/ui/PixelSteps.tsx';
import styles from './Onboarding.module.css';

const POINTS = [
  'Записывайте еду по фото, мы оценим калорийность и БЖУ',
  'Следите за дневным ориентиром',
  'Получайте подборку блюд в кафе рядом, часто со скидкой',
];

export function WelcomeStep() {
  const navigate = useNavigate();
  const profile = useProfile().data;
  const name = profile?.firstName?.trim();
  return (
    <Page>
      <div className={styles.hero}>
        <PixelSteps corner="top-right" />
        <h1 className={styles.heroTitle}>
          {name !== undefined && name.length > 0 ? `Привет, ${name}!` : 'Привет!'}
        </h1>
      </div>
      <ol className={styles.points}>
        {POINTS.map((point, index) => (
          <li key={point} className={styles.point}>
            <span className={styles.number} aria-hidden="true">
              {String(index + 1).padStart(2, '0')}
            </span>
            <span>{point}</span>
          </li>
        ))}
      </ol>
      <p className={styles.lead}>Всё, что вы записали в чате с ботом, уже здесь.</p>
      <ActionBar>
        <Button
          size="large"
          stretched
          onClick={() => {
            void navigate('/onboarding/consent');
          }}
        >
          Начать
        </Button>
      </ActionBar>
    </Page>
  );
}
