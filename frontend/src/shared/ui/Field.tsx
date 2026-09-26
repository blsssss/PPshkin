import { Input } from '@maxhub/max-ui';
import { useId, type ComponentProps } from 'react';
import styles from './Field.module.css';

type InputProps = Omit<ComponentProps<typeof Input>, 'id' | 'hint'>;

export function Field({
  label,
  hint,
  error,
  ...input
}: InputProps & { label: string; hint?: string; error?: string | undefined }) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [error !== undefined ? errorId : null, hint !== undefined ? hintId : null]
    .filter((item) => item !== null)
    .join(' ');
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <Input
        {...input}
        id={id}
        aria-invalid={error !== undefined}
        aria-describedby={describedBy.length > 0 ? describedBy : undefined}
      />
      {error !== undefined && (
        <span id={errorId} className={styles.error}>
          {error}
        </span>
      )}
      {hint !== undefined && (
        <span id={hintId} className={styles.hint}>
          {hint}
        </span>
      )}
    </div>
  );
}
