import type { CSSProperties } from 'react';
import styles from './Skeleton.module.css';

export function Skeleton({
  width = '100%',
  height = 16,
  count = 1,
}: {
  width?: string | number;
  height?: number;
  count?: number;
}) {
  const style: CSSProperties = { width, height };
  return (
    <div className={styles.stack} aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <span key={index} className={styles.block} style={style} />
      ))}
    </div>
  );
}
