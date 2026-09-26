import type { ReactNode } from 'react';
import { hasSystemBackButton, useBackButton } from '../../max/bridge.ts';
import { useBackNavigation } from '../useBackNavigation.ts';
import { PixelIcon } from './PixelIcon.tsx';
import { closeTopSheet } from './sheetStack.ts';
import styles from './ScreenHeader.module.css';

function BackButton({ onBack }: { onBack: () => void }) {
  if (hasSystemBackButton()) return null;
  return (
    <button type="button" className={styles.back} onClick={onBack} aria-label="Назад">
      <PixelIcon name="back" size={20} />
    </button>
  );
}

function PathBack({ fallback }: { fallback: string }) {
  return <BackButton onBack={useBackNavigation(fallback)} />;
}

function ActionBack({ onBack }: { onBack: () => void }) {
  const goBack = () => {
    if (!closeTopSheet()) onBack();
  };
  useBackButton(goBack);
  return <BackButton onBack={goBack} />;
}

function BackControl({ back }: { back: string | (() => void) }) {
  return typeof back === 'string' ? <PathBack fallback={back} /> : <ActionBack onBack={back} />;
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
