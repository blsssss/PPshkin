import type { ReactNode } from 'react';
import { Logo } from '../../shared/ui/Logo.tsx';
import { PixelSteps } from '../../shared/ui/PixelSteps.tsx';
import styles from './HeroScreen.module.css';

export function HeroScreen({
  title,
  description,
  children,
  busy = false,
}: {
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  busy?: boolean;
}) {
  return (
    <main className={styles.hero} aria-busy={busy}>
      <PixelSteps corner="top-right" />
      <PixelSteps corner="bottom-left" />
      <div className={styles.content}>
        <Logo />
        <h1 className={styles.title}>{title}</h1>
        {description !== undefined && <p className={styles.description}>{description}</p>}
        {children !== undefined && <div className={styles.actions}>{children}</div>}
      </div>
    </main>
  );
}
