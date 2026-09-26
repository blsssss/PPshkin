import { Button } from '@maxhub/max-ui';
import { useState, type ReactNode } from 'react';
import { BottomSheet } from './BottomSheet.tsx';
import styles from './ConfirmSheet.module.css';

export function ConfirmSheet({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Отмена',
  destructive = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => Promise<void> | void;
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      open={open}
      title={title}
      onClose={() => {
        if (!busy) onCancel();
      }}
    >
      {description !== undefined && <div className={styles.description}>{description}</div>}
      <div className={styles.actions}>
        <Button
          size="large"
          stretched
          variant={destructive ? 'destructive' : 'primary'}
          loading={busy}
          onClick={() => {
            void confirm();
          }}
        >
          {confirmLabel}
        </Button>
        <Button size="large" stretched variant="secondary" disabled={busy} onClick={onCancel}>
          {cancelLabel}
        </Button>
      </div>
    </BottomSheet>
  );
}
