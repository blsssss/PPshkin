import { Button } from '@maxhub/max-ui';
import { useRef, useState } from 'react';
import { ApiError } from '../../api/errors.ts';
import { userMessage } from '../../api/messages.ts';
import { haptic } from '../../max/bridge.ts';
import { ImageDecodeError, prepareImage } from '../image.ts';
import { useOnline } from '../useOnline.ts';
import { Notice } from './Notice.tsx';
import { Photo } from './Photo.tsx';
import styles from './PhotoField.module.css';

export const PHOTO_MAX_BYTES = 4 * 1024 * 1024;
const PHOTO_MAX_SIDE = 1920;

function failureText(error: unknown): string {
  if (error instanceof ImageDecodeError) return 'Не удалось прочитать фото, выберите другой файл';
  if (error instanceof ApiError && error.code === 'image_too_large') {
    return 'Фото больше 5 МБ, выберите файл поменьше';
  }
  return userMessage(error);
}

export function PhotoField({
  label,
  url,
  alt,
  hint,
  onUpload,
  onRemove,
}: {
  label: string;
  url: string | null;
  alt: string;
  hint?: string;
  onUpload: (file: File) => Promise<unknown>;
  onRemove: () => Promise<unknown>;
}) {
  const online = useOnline();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const run = async (work: () => Promise<unknown>) => {
    setFailure(null);
    setBusy(true);
    try {
      await work();
    } catch (error) {
      haptic.error();
      setFailure(failureText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.field} aria-label={label}>
      <h2 className={styles.title}>{label}</h2>
      <Photo url={url} alt={alt} />
      {url === null && (
        <p className={styles.hint}>{hint ?? 'Фото пока нет, карточка показывается без него'}</p>
      )}
      <input
        ref={fileRef}
        className={styles.input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label={`${label}: выбрать файл`}
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file === undefined) return;
          void run(async () => onUpload(await prepareImage(file, PHOTO_MAX_SIDE, PHOTO_MAX_BYTES)));
        }}
      />
      <div className={styles.actions}>
        <Button
          size="medium"
          variant="secondary"
          stretched
          loading={busy}
          disabled={!online}
          onClick={() => {
            fileRef.current?.click();
          }}
        >
          {url === null ? 'Загрузить фото' : 'Заменить фото'}
        </Button>
        {url !== null && (
          <Button
            size="medium"
            variant="secondary"
            stretched
            disabled={busy || !online}
            onClick={() => {
              void run(onRemove);
            }}
          >
            Удалить фото
          </Button>
        )}
      </div>
      {failure !== null && <Notice tone="error">{failure}</Notice>}
    </section>
  );
}
