import styles from './Logo.module.css';

export function Logo() {
  return (
    <span className={styles.logo}>
      <svg className={styles.mark} viewBox="0 0 4 4" shapeRendering="crispEdges" aria-hidden="true">
        <rect x="0" y="1" width="3" height="3" className={styles.body} />
        <rect x="3" y="0" width="1" height="1" className={styles.corner} />
      </svg>
      <span className={styles.word}>ППшкин</span>
    </span>
  );
}
