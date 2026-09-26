import type { ReactNode } from 'react';
import { cx } from './cx.ts';
import styles from './Chip.module.css';
import { haptic } from '../../max/bridge.ts';

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
  toggles = false,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  disabled?: boolean;
  toggles?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cx(styles.chip, pressed && styles.pressed)}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={() => {
        if (!pressed || toggles) haptic.selection();
        onClick();
      }}
    >
      {children}
    </button>
  );
}
