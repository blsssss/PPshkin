import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { hasSystemBackButton, useBackButton } from '../../max/bridge.ts';
import { PixelIcon } from './PixelIcon.tsx';
import styles from './ScreenHeader.module.css';

function BackControl({ back }: { back: string | (() => void) }) {
  const navigate = useNavigate();
  const goBack = () => {
    if (typeof back === 'string') void navigate(back);
    else back();
  };
  useBackButton(goBack);
  if (hasSystemBackButton()) return null;
  return (
    <button type="button" className={styles.back} onClick={goBack} aria-label="Назад">
      <PixelIcon name="back" size={20} />
    </button>
  );
}

export function ScreenHeader({
  title,
  back,
  after,
}: {
  title: string;
  back?: string | (() => void);
  after?: ReactNode;
}) {
  return (
    <header className={styles.header}>
      {back !== undefined && <BackControl back={back} />}
      <h1 className={styles.title}>{title}</h1>
      {after !== undefined && <div className={styles.after}>{after}</div>}
    </header>
  );
}
