import type { ReactNode } from 'react';
import { cx } from './cx.ts';
import styles from './Notice.module.css';

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'error'; children: ReactNode }) {
  return (
    <div
      className={cx(styles.notice, tone === 'error' && styles.error)}
      role={tone === 'error' ? 'alert' : undefined}
    >
      {children}
    </div>
  );
}
