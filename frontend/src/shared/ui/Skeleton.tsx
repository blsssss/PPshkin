import { useEffect, useState, type CSSProperties } from 'react';
import styles from './Skeleton.module.css';

const SKELETON_DELAY_MS = 300;

export function Skeleton({
  width = '100%',
  height = 16,
  count = 1,
}: {
  width?: string | number;
  height?: number;
  count?: number;
}) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      setShown(true);
    }, SKELETON_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, []);
  const style: CSSProperties = { width, height };
  return (
    <div className={styles.stack} aria-hidden="true" style={shown ? undefined : { visibility: 'hidden' }}>
      {Array.from({ length: count }, (_, index) => (
        <span key={index} className={styles.block} style={style} />
      ))}
    </div>
  );
}
