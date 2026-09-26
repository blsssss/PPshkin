import { useOnline } from '../useOnline.ts';
import styles from './OfflineBanner.module.css';

export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div className={styles.banner} role="alert">
      Нет подключения к интернету
    </div>
  );
}
