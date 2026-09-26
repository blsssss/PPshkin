import type { ReactNode } from 'react';
import styles from './ActionBar.module.css';

export function ActionBar({ children }: { children: ReactNode }) {
  return <div className={styles.bar}>{children}</div>;
}
