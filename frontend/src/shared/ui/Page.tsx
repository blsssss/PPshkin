import type { ReactNode } from 'react';
import styles from './Page.module.css';

export function Page({ children }: { children: ReactNode }) {
  return <main className={styles.page}>{children}</main>;
}
