import { cx } from './cx.ts';
import styles from './PixelSteps.module.css';

const STEPS = [
  { x: 6, y: 0, width: 2, height: 1, tone: 'violet' },
  { x: 5, y: 1, width: 3, height: 1, tone: 'cyan' },
  { x: 7, y: 2, width: 1, height: 1, tone: 'pink' },
  { x: 4, y: 2, width: 3, height: 1, tone: 'cyan' },
  { x: 3, y: 3, width: 5, height: 1, tone: 'blue' },
] as const;

export function PixelSteps({ corner = 'top-right' }: { corner?: 'top-right' | 'bottom-left' }) {
  return (
    <svg
      className={cx(styles.steps, styles[corner])}
      viewBox="0 0 8 4"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {STEPS.map((step) => (
        <rect
          key={`${step.x}-${step.y}`}
          x={step.x}
          y={step.y}
          width={step.width}
          height={step.height}
          className={styles[step.tone]}
        />
      ))}
    </svg>
  );
}
