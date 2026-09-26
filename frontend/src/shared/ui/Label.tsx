import type { ReactNode } from 'react';
import { cx } from './cx.ts';
import styles from './Label.module.css';

type LabelTone = 'violet' | 'blue' | 'cyan' | 'pink';

export function Label({ tone = 'violet', children }: { tone?: LabelTone; children: ReactNode }) {
  return <span className={cx(styles.label, styles[tone])}>{children}</span>;
}
