import { Button } from '@maxhub/max-ui';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { isApiError } from '../../api/errors.ts';
import { api } from '../../api/index.ts';
import { userMessage } from '../../api/messages.ts';
import { useConsents, useProfile, useUpdateProfile } from '../../api/profile.ts';
import { validateKcalTarget } from '../../shared/target/body.ts';
import { KcalTargetPicker } from '../../shared/target/KcalTargetPicker.tsx';
import { TargetCalculator } from '../../shared/target/TargetCalculator.tsx';
import { useOnline } from '../../shared/useOnline.ts';
import { ActionBar } from '../../shared/ui/ActionBar.tsx';
import { Chip, ChipRow } from '../../shared/ui/Chip.tsx';
import { ChoiceList } from '../../shared/ui/ChoiceList.tsx';
import { ConfirmSheet } from '../../shared/ui/ConfirmSheet.tsx';
import { Notice } from '../../shared/ui/Notice.tsx';
import { Page } from '../../shared/ui/Page.tsx';
import { ScreenHeader } from '../../shared/ui/ScreenHeader.tsx';
import { ScreenState } from '../../shared/ui/ScreenState.tsx';
import { Skeleton } from '../../shared/ui/Skeleton.tsx';
import { useToast } from '../../shared/ui/Toast.tsx';
import { GOAL_LABELS, GOALS, TAG_LABELS, type Goal, type Tag } from '../../shared/vocabulary.ts';
import { useForgetAccount } from '../../app/forgetAccount.ts';
import { ConsentText } from '../onboarding/OnboardingStep.tsx';
import { MAX_DISLIKED_TAGS } from './model.ts';
import styles from './Profile.module.css';
import { useLeave } from '../../shared/appHistory.ts';
import { haptic } from '../../max/bridge.ts';

const TAGS = Object.keys(TAG_LABELS) as Tag[];
const GOAL_OPTIONS = GOALS.map((value) => ({ value, label: GOAL_LABELS[value] }));

export function TargetScreen() {
  const leave = useLeave();
  const toast = useToast();
  const online = useOnline();
  const profile = useProfile().data;
  const update = useUpdateProfile();
  const [goal, setGoal] = useState<Goal | null>(profile?.goal ?? null);
  const [kcal, setKcal] = useState(String(profile?.kcalTarget ?? 2000));
  const [error, setError] = useState<string | undefined>(undefined);

  const save = () => {
    const target = validateKcalTarget(kcal);
    if (typeof target === 'string') {
      setError(target);
      return;
    }
    update.mutate(
      { kcalTarget: target, goal },
      {
        onSuccess: () => {
          toast.show('Ориентир сохранён');
          leave('/profile');
        },
        onError: (failure) => {
          haptic.error();
          if (!isApiError(failure, 'consent_required')) toast.show(userMessage(failure), { tone: 'error' });
        },
      },
    );
  };

  return (
    <Page>
      <ScreenHeader title="Расчёт ориентира" back="/profile" />
      <ChoiceList
        legend="Цель"
        options={GOAL_OPTIONS}
        value={goal}
        onChange={(value) => {
          setGoal(value);
        }}
      />
      <TargetCalculator
        goal={goal}
        onUse={(value) => {
          setKcal(String(value));
          setError(undefined);
        }}
      />
      <h2 className={styles.sectionTitle}>Ориентир</h2>
      <KcalTargetPicker
        value={kcal}
        onChange={(value) => {
          setKcal(value);
          setError(undefined);
        }}
        error={error}
      />
      <ActionBar sends>
        <Button size="large" stretched loading={update.isPending} disabled={!online} onClick={save}>
          Сохранить ориентир
        </Button>
      </ActionBar>
    </Page>
  );
}

export function TagsScreen() {
  const leave = useLeave();
  const toast = useToast();
  const online = useOnline();
  const profile = useProfile().data;
  const update = useUpdateProfile();
  const [selected, setSelected] = useState<Tag[]>(profile?.dislikedTags ?? []);
  const original = profile?.dislikedTags ?? [];
  const dirty = selected.length !== original.length || selected.some((tag) => !original.includes(tag));

  return (
    <Page>
      <ScreenHeader title="Не предлагать" back="/profile" />
      <p className={styles.muted}>Блюда с этими признаками не попадут в рекомендации.</p>
      <p className={styles.counter} aria-live="polite">
        Выбрано {selected.length} из {MAX_DISLIKED_TAGS}
      </p>
      <ChipRow label="Нелюбимые продукты">
        {TAGS.map((tag) => {
          const pressed = selected.includes(tag);
          return (
            <Chip
              key={tag}
              pressed={pressed}
              toggles
              disabled={!pressed && selected.length >= MAX_DISLIKED_TAGS}
              onClick={() => {
                setSelected((current) =>
                  pressed ? current.filter((item) => item !== tag) : [...current, tag],
                );
              }}
            >
              {TAG_LABELS[tag]}
            </Chip>
          );
        })}
      </ChipRow>
      <ActionBar sends>
        <Button
          size="large"
          stretched
          disabled={!dirty || !online}
          loading={update.isPending}
          onClick={() => {
            update.mutate(
              { dislikedTags: selected },
              {
                onSuccess: () => {
                  toast.show('Сохранено');
                  leave('/profile');
                },
                onError: (error) => {
                  if (!isApiError(error, 'consent_required'))
                    toast.show(userMessage(error), { tone: 'error' });
                },
              },
            );
          }}
        >
          Сохранить
        </Button>
        <Button
          size="large"
          stretched
          variant="secondary"
          disabled={selected.length === 0}
          onClick={() => {
            setSelected([]);
          }}
        >
          Сбросить все
        </Button>
      </ActionBar>
    </Page>
  );
}

export function ConsentTextScreen() {
  const navigate = useNavigate();
  const { kind } = useParams();
  const consents = useConsents();
  const document = consents.data?.find((item) => item.kind === kind);
  return (
    <Page>
      <ScreenHeader title={document?.title ?? 'Согласие'} back="/profile" />
      {consents.isPending && <Skeleton height={18} count={8} />}
      {consents.isError && (
        <ScreenState
          status="error"
          title="Не удалось загрузить текст согласия"
          description={userMessage(consents.error)}
          error={consents.error}
          action={{
            label: 'Повторить',
            onClick: () => {
              void consents.refetch();
            },
          }}
        />
      )}
      {consents.data !== undefined && document === undefined && (
        <ScreenState
          status="empty"
          title="Такого согласия нет"
          action={{
            label: 'В профиль',
            onClick: () => {
              void navigate('/profile');
            },
          }}
        />
      )}
      {document !== undefined && <ConsentText text={document.text} />}
    </Page>
  );
}

const CONSEQUENCES = [
  'удаляются профиль, дневник питания, настройки, согласия и состояние диалога с ботом;',
  'активные брони отменяются, забронированные порции возвращаются заведениям;',
  'в истории предложений и броней заведений остаются только обезличенные записи без связи с вами;',
  'если вы владелец заведения, оно отвязывается от аккаунта;',
  'действие нельзя отменить.',
];

export function DeleteAccountScreen() {
  const forget = useForgetAccount();
  const online = useOnline();
  const [confirm, setConfirm] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: async () => {
      await api.DELETE('/api/v1/me');
    },
  });

  return (
    <Page>
      <ScreenHeader title="Удаление аккаунта" back="/profile" />
      <ul className={styles.consequences}>
        {CONSEQUENCES.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      {notice !== null && <Notice tone="error">{notice}</Notice>}
      <ActionBar sends>
        <Button
          size="large"
          stretched
          variant="destructive"
          disabled={!online}
          onClick={() => {
            setConfirm(true);
          }}
        >
          {notice !== null ? 'Повторить' : 'Удалить аккаунт'}
        </Button>
      </ActionBar>
      <ConfirmSheet
        open={confirm}
        title="Удалить аккаунт и все данные?"
        description="Это нельзя отменить."
        confirmLabel="Удалить"
        destructive
        onCancel={() => {
          setConfirm(false);
        }}
        onConfirm={async () => {
          setNotice(null);
          try {
            await remove.mutateAsync();
            setConfirm(false);
            forget();
          } catch (error) {
            haptic.error();
            setConfirm(false);
            setNotice(userMessage(error));
          }
        }}
      />
    </Page>
  );
}
