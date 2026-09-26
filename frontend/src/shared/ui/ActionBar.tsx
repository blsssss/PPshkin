import type { ReactNode } from 'react';
import { useOnline } from '../useOnline.ts';
import styles from './ActionBar.module.css';

export function ActionBar({ children, sends = false }: { children: ReactNode; sends?: boolean }) {
  const online = useOnline();
  return (
    <div className={styles.bar}>
      {sends && !online && (
        <p className={styles.offline} role="status">
          Нет соединения с интернетом, отправьте, когда сеть появится
        </p>
      )}
      {children}
    </div>
  );
}
