import { cx } from './cx.ts';
import styles from './BarChart.module.css';

export interface Bar {
  key: string;
  value: number;
  label: string;
  caption: string;
  onClick?: () => void;
}

export function BarChart({
  bars,
  target,
  targetLabel,
  height = 140,
  compact = false,
  title,
}: {
  bars: readonly Bar[];
  target?: number | undefined;
  targetLabel?: string | undefined;
  height?: number;
  compact?: boolean;
  title: string;
}) {
  const peak = Math.max(1, target ?? 0, ...bars.map((bar) => bar.value));
  const scale = (value: number) => Math.round((value / peak) * 100);
  return (
    <figure className={cx(styles.chart, (compact || bars.length > 14) && styles.compact)} aria-label={title}>
      <div className={styles.plot} style={{ height }}>
        {target !== undefined && target > 0 && (
          <div className={styles.target} style={{ bottom: `${scale(target)}%` }}>
            {targetLabel !== undefined && !compact && (
              <span className={styles.targetLabel}>{targetLabel}</span>
            )}
          </div>
        )}
        {bars.map((bar) => {
          const body = (
            <span
              className={cx(styles.bar, target !== undefined && bar.value > target && styles.over)}
              style={{ height: `${bar.value > 0 ? Math.max(scale(bar.value), 2) : 0}%` }}
            />
          );
          return bar.onClick === undefined ? (
            <div key={bar.key} className={styles.column} role="img" aria-label={bar.label}>
              {body}
            </div>
          ) : (
            <button
              key={bar.key}
              type="button"
              className={styles.column}
              aria-label={bar.label}
              onClick={bar.onClick}
            >
              {body}
            </button>
          );
        })}
      </div>
      {!compact && (
        <div className={styles.captions} aria-hidden="true">
          {bars.map((bar, index) => (
            <span key={bar.key}>{bars.length <= 14 || index % 5 === 0 ? bar.caption : ''}</span>
          ))}
        </div>
      )}
    </figure>
  );
}
