import { Switch } from '@maxhub/max-ui';
import { useId, useState } from 'react';
import { userMessage } from '../../api/messages.ts';
import { useNotificationSettings, useUpdateNotificationSettings } from '../../api/profile.ts';
import { haptic } from '../../max/bridge.ts';
import { useOnline } from '../../shared/useOnline.ts';
import { Notice } from '../../shared/ui/Notice.tsx';
import { Page } from '../../shared/ui/Page.tsx';
import { ScreenHeader } from '../../shared/ui/ScreenHeader.tsx';
import { ScreenState } from '../../shared/ui/ScreenState.tsx';
import { Skeleton } from '../../shared/ui/Skeleton.tsx';
import { useToast } from '../../shared/ui/Toast.tsx';
import {
  DEFAULT_QUIET_HOURS,
  groupKinds,
  NOTIFICATION_LABELS,
  QUIET_TIME_OPTIONS,
  quietHoursCaption,
  quietHoursError,
  type NotificationKindSetting,
  type NotificationSettings,
  type QuietHours,
} from './notificationsModel.ts';
import styles from './Profile.module.css';

type Patch = Parameters<ReturnType<typeof useUpdateNotificationSettings>['mutate']>[0];

function useSave() {
  const toast = useToast();
  const update = useUpdateNotificationSettings();
  const save = (patch: Patch) => {
    update.mutate(patch, {
      onError: (error) => {
        haptic.error();
        toast.show(userMessage(error), { tone: 'error' });
      },
    });
  };
  return { save, pending: update.isPending ? update.variables : undefined };
}

function KindRow({
  item,
  checked,
  disabled,
  onToggle,
}: {
  item: NotificationKindSetting;
  checked: boolean;
  disabled: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  const { label, hint } = NOTIFICATION_LABELS[item.kind];
  return (
    <div className={styles.card}>
      <label className={styles.switchRow}>
        <span className={styles.cardTitle}>{label}</span>
        <Switch
          checked={checked}
          disabled={disabled || !item.editable}
          onChange={(event) => {
            onToggle(event.target.checked);
          }}
        />
      </label>
      <p className={styles.muted}>{hint}</p>
    </div>
  );
}

function QuietHoursSection({
  settings,
  disabled,
  pending,
  save,
}: {
  settings: NotificationSettings;
  disabled: boolean;
  pending: Patch | undefined;
  save: (patch: Patch) => void;
}) {
  const fromId = useId();
  const untilId = useId();
  const errorId = useId();
  const [draft, setDraft] = useState<QuietHours | null>(null);
  const pendingHours = pending?.quietHours;
  const shown = pendingHours !== undefined ? pendingHours : (draft ?? settings.quietHours);
  const enabled = shown !== null;
  const hours = shown ?? settings.quietHours ?? DEFAULT_QUIET_HOURS;
  const error = draft === null ? null : quietHoursError(draft);

  const change = (next: QuietHours) => {
    setDraft(next);
    if (quietHoursError(next) !== null) return;
    setDraft(null);
    save({ quietHours: next });
  };

  return (
    <section className={styles.section} aria-label="Тихие часы">
      <h2 className={styles.sectionTitle}>Тихие часы</h2>
      <div className={styles.card}>
        <label className={styles.switchRow}>
          <span className={styles.cardTitle}>Не беспокоить ночью</span>
          <Switch
            checked={enabled}
            disabled={disabled}
            onChange={(event) => {
              setDraft(null);
              save({ quietHours: event.target.checked ? DEFAULT_QUIET_HOURS : null });
            }}
          />
        </label>
        {enabled && (
          <>
            <div className={styles.row}>
              <div>
                <label className={styles.label} htmlFor={fromId}>
                  С
                </label>
                <select
                  id={fromId}
                  className={styles.select}
                  value={(draft ?? hours).from}
                  disabled={disabled}
                  aria-invalid={error !== null}
                  aria-describedby={error !== null ? errorId : undefined}
                  onChange={(event) => {
                    change({ ...(draft ?? hours), from: event.target.value });
                  }}
                >
                  {QUIET_TIME_OPTIONS.map((time) => (
                    <option key={time} value={time}>
                      {time}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={styles.label} htmlFor={untilId}>
                  До
                </label>
                <select
                  id={untilId}
                  className={styles.select}
                  value={(draft ?? hours).until}
                  disabled={disabled}
                  aria-invalid={error !== null}
                  aria-describedby={error !== null ? errorId : undefined}
                  onChange={(event) => {
                    change({ ...(draft ?? hours), until: event.target.value });
                  }}
                >
                  {QUIET_TIME_OPTIONS.map((time) => (
                    <option key={time} value={time}>
                      {time}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {error !== null && (
              <p id={errorId} className={styles.error}>
                {error}
              </p>
            )}
            <p className={styles.muted}>{quietHoursCaption(hours, settings.timezone)}</p>
          </>
        )}
        {!enabled && <p className={styles.muted}>Сообщения приходят со звуком в любое время.</p>}
      </div>
    </section>
  );
}

function KindsSection({
  title,
  items,
  disabled,
  pending,
  save,
}: {
  title: string;
  items: NotificationKindSetting[];
  disabled: boolean;
  pending: Patch | undefined;
  save: (patch: Patch) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section className={styles.section} aria-label={title}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      {items.map((item) => {
        const target = pending?.kinds?.find((change) => change.kind === item.kind);
        return (
          <KindRow
            key={item.kind}
            item={item}
            checked={target?.enabled ?? item.enabled}
            disabled={disabled}
            onToggle={(enabled) => {
              save({ kinds: [{ kind: item.kind, enabled }] });
            }}
          />
        );
      })}
    </section>
  );
}

export function NotificationsScreen() {
  const settings = useNotificationSettings();
  const online = useOnline();
  const { save, pending } = useSave();
  const data = settings.data;
  const disabled = !online || pending !== undefined;
  return (
    <Page>
      <ScreenHeader title="Уведомления" back="/profile" />
      {settings.isPending && <Skeleton height={64} count={5} />}
      {settings.isError && data === undefined && (
        <ScreenState
          status="error"
          title="Не удалось загрузить настройки уведомлений"
          description={userMessage(settings.error)}
          error={settings.error}
          action={{
            label: 'Повторить',
            onClick: () => {
              void settings.refetch();
            },
          }}
        />
      )}
      {data !== undefined && (
        <>
          {!online && (
            <Notice>Нет соединения с интернетом, настройки можно поменять, когда сеть появится</Notice>
          )}
          <KindsSection
            title="Брони"
            items={groupKinds(data).guest}
            disabled={disabled}
            pending={pending}
            save={save}
          />
          <KindsSection
            title="Моё заведение"
            items={groupKinds(data).venue}
            disabled={disabled}
            pending={pending}
            save={save}
          />
          <QuietHoursSection settings={data} disabled={disabled} pending={pending} save={save} />
        </>
      )}
    </Page>
  );
}
