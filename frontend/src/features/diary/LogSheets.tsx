import { Button, Textarea } from '@maxhub/max-ui';
import { useId, useState, type ChangeEvent, type ReactNode } from 'react';
import { useOnline } from '../../shared/useOnline.ts';
import { BottomSheet } from '../../shared/ui/BottomSheet.tsx';
import styles from './Diary.module.css';

const MAX_DESCRIPTION = 500;

export function PhotoSheet({
  open,
  title = 'Фото еды',
  onClose,
  onFile,
  extra,
}: {
  open: boolean;
  title?: string;
  onClose: () => void;
  onFile: (file: File) => void;
  extra?: ReactNode;
}) {
  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file !== undefined) onFile(file);
  };
  return (
    <BottomSheet open={open} title={title} onClose={onClose}>
      <div className={styles.sheetActions}>
        <label className={styles.fileButton}>
          Камера
          <input
            className="ppsh-visually-hidden"
            type="file"
            accept="image/*"
            capture="environment"
            onChange={pick}
          />
        </label>
        <label className={styles.fileButton}>
          Галерея
          <input className="ppsh-visually-hidden" type="file" accept="image/*" onChange={pick} />
        </label>
        {extra}
      </div>
      <p className={styles.muted}>Фото отправляется в сервис распознавания без ваших данных и не хранится.</p>
    </BottomSheet>
  );
}

export function TextSheet({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (description: string) => void;
}) {
  const [text, setText] = useState('');
  const online = useOnline();
  const fieldId = useId();
  const trimmed = text.trim();
  return (
    <BottomSheet open={open} title="Описать словами" onClose={onClose}>
      <label className={styles.fieldLabel} htmlFor={fieldId}>
        Что вы съели
      </label>
      <Textarea
        id={fieldId}
        value={text}
        maxLength={MAX_DESCRIPTION}
        placeholder="Например: борщ и кусок чёрного хлеба"
        onChange={(event) => {
          setText(event.target.value);
        }}
      />
      <p className={styles.counter} aria-live="polite">
        {text.length} из {MAX_DESCRIPTION}
      </p>
      <Button
        size="large"
        stretched
        disabled={trimmed.length === 0 || !online}
        onClick={() => {
          onSubmit(trimmed);
          setText('');
        }}
      >
        Записать
      </Button>
    </BottomSheet>
  );
}
