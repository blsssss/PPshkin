import { formatKcal } from '../format.ts';
import { Chip, ChipRow } from '../ui/Chip.tsx';
import { Field } from '../ui/Field.tsx';
import { KCAL_PRESETS, KCAL_TARGET_MAX, KCAL_TARGET_MIN } from './body.ts';

export function KcalTargetPicker({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  error?: string | undefined;
}) {
  return (
    <div>
      <ChipRow label="Быстрый выбор ориентира">
        {KCAL_PRESETS.map((preset) => (
          <Chip
            key={preset}
            pressed={value === String(preset)}
            onClick={() => {
              onChange(String(preset));
            }}
          >
            {formatKcal(preset)}
          </Chip>
        ))}
      </ChipRow>
      <Field
        label="Свой ориентир, ккал в день"
        inputMode="numeric"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        hint={`От ${KCAL_TARGET_MIN} до ${KCAL_TARGET_MAX} ккал`}
        error={error}
      />
    </div>
  );
}
