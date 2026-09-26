import { Button } from '@maxhub/max-ui';
import { useState } from 'react';
import { share } from '../share.ts';
import { BottomSheet } from './BottomSheet.tsx';
import { useToast } from './Toast.tsx';
import styles from './ShareButton.module.css';

export function ShareButton({
  text,
  link,
  label = 'Поделиться',
  size = 'large',
}: {
  text: string;
  link: string;
  label?: string;
  size?: 'small' | 'medium' | 'large';
}) {
  const toast = useToast();
  const [manual, setManual] = useState(false);
  return (
    <>
      <Button
        size={size}
        variant="secondary"
        stretched
        onClick={() => {
          void share({ text, link }).then((outcome) => {
            if (outcome === 'copied') toast.show('Ссылка скопирована');
            if (outcome === 'manual') setManual(true);
          });
        }}
      >
        {label}
      </Button>
      <BottomSheet
        open={manual}
        title="Ссылка для отправки"
        onClose={() => {
          setManual(false);
        }}
      >
        <p className={styles.hint}>Скопируйте ссылку и отправьте её в чат.</p>
        <textarea
          className={styles.link}
          readOnly
          value={`${text}\n${link}`}
          aria-label="Текст и ссылка"
          onFocus={(event) => {
            event.target.select();
          }}
        />
      </BottomSheet>
    </>
  );
}
