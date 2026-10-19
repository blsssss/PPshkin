import { Button } from '@maxhub/max-ui';
import { useId, useState } from 'react';
import { isApiError } from '../../api/errors.ts';
import { userMessage } from '../../api/messages.ts';
import { haptic } from '../../max/bridge.ts';
import { BottomSheet } from '../../shared/ui/BottomSheet.tsx';
import { ChoiceList } from '../../shared/ui/ChoiceList.tsx';
import { useToast } from '../../shared/ui/Toast.tsx';
import { COMPLAINT_REASONS, COMPLAINT_TEXT_LIMIT, type ComplaintReason } from './model.ts';
import { useCreateComplaint } from './queries.ts';
import styles from './ComplaintSheet.module.css';

const FAILURES: Record<string, string> = {
  complaint_exists: 'Жалоба на эту бронь уже отправлена',
  complaint_limit: 'Сегодня отправлено максимум жалоб, повторите завтра',
};

function Form({
  venueId,
  bookingId,
  onClose,
}: {
  venueId: number;
  bookingId: number | undefined;
  onClose: () => void;
}) {
  const toast = useToast();
  const create = useCreateComplaint();
  const textId = useId();
  const [reason, setReason] = useState<ComplaintReason | null>(null);
  const [text, setText] = useState('');

  const submit = async () => {
    if (reason === null) return;
    const trimmed = text.trim();
    try {
      await create.mutateAsync({
        venueId,
        reason,
        ...(bookingId === undefined ? {} : { bookingId }),
        ...(trimmed.length === 0 ? {} : { text: trimmed }),
      });
      haptic.success();
      toast.show('Спасибо, разберёмся');
      onClose();
    } catch (error) {
      haptic.error();
      const known = Object.entries(FAILURES).find(([code]) => isApiError(error, code));
      toast.show(known?.[1] ?? userMessage(error), { tone: 'error' });
      if (known !== undefined) onClose();
    }
  };

  return (
    <div className={styles.form}>
      <ChoiceList legend="Что случилось" options={COMPLAINT_REASONS} value={reason} onChange={setReason} />
      <div>
        <label className={styles.label} htmlFor={textId}>
          Подробности, если хотите
        </label>
        <textarea
          id={textId}
          className={styles.textarea}
          value={text}
          maxLength={COMPLAINT_TEXT_LIMIT}
          onChange={(event) => {
            setText(event.target.value);
          }}
        />
      </div>
      <Button
        size="large"
        stretched
        disabled={reason === null}
        loading={create.isPending}
        onClick={() => {
          void submit();
        }}
      >
        Отправить
      </Button>
    </div>
  );
}

export function ComplaintSheet({
  open,
  venueId,
  bookingId,
  title,
  onClose,
}: {
  open: boolean;
  venueId: number;
  bookingId?: number;
  title: string;
  onClose: () => void;
}) {
  return (
    <BottomSheet open={open} title={title} onClose={onClose}>
      {open && <Form venueId={venueId} bookingId={bookingId} onClose={onClose} />}
    </BottomSheet>
  );
}
