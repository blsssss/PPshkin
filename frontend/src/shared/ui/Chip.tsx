import type { ReactNode } from 'react';
import { cx } from './cx.ts';
import styles from './Chip.module.css';

export function ChipRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.row} role="group" aria-label={label}>
      {children}
    </div>
  );
}

export function Chip({
  pressed,
  onClick,
  disabled,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cx(styles.chip, pressed && styles.pressed)}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
