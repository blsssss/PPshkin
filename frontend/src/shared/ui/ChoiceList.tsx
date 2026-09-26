import { Radio } from '@maxhub/max-ui';
import { useId } from 'react';
import { cx } from './cx.ts';
import styles from './ChoiceList.module.css';

export function ChoiceList<T extends string>({
  legend,
  options,
  value,
  onChange,
  error,
}: {
  legend: string;
  options: readonly { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
  error?: string | undefined;
}) {
  const name = useId();
  const errorId = `${name}-error`;
  return (
    <fieldset className={styles.group} aria-describedby={error !== undefined ? errorId : undefined}>
      <legend className={styles.legend}>{legend}</legend>
      {options.map((option) => (
        <label key={option.value} className={cx(styles.option, value === option.value && styles.checked)}>
          <Radio
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => {
              onChange(option.value);
            }}
          />
          <span>{option.label}</span>
        </label>
      ))}
      {error !== undefined && (
        <span id={errorId} className={styles.error}>
          {error}
        </span>
      )}
    </fieldset>
  );
}
