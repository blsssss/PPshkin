import { Button, Switch } from '@maxhub/max-ui';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import type { UserProfile } from '../../api/client.ts';
import { isApiError } from '../../api/errors.ts';
import { userMessage } from '../../api/messages.ts';
import {
  useConsents,
  useGrantConsent,
  useProfile,
  useRevokeConsent,
  useSaveLocation,
  useUpdateProfile,
} from '../../api/profile.ts';
import { botLink } from '../../app/startParam.ts';
import { openMaxLink } from '../../max/bridge.ts';
import { formatKcal } from '../../shared/format.ts';
import { setDevicePoint } from '../../shared/geo/devicePoint.ts';
import { useGeolocation } from '../../shared/geo/useGeolocation.ts';
import { validateKcalTarget } from '../../shared/target/body.ts';
import { KcalTargetPicker } from '../../shared/target/KcalTargetPicker.tsx';
import { useOnline } from '../../shared/useOnline.ts';
import { ActionBar } from '../../shared/ui/ActionBar.tsx';
import { BottomSheet } from '../../shared/ui/BottomSheet.tsx';
import { ChoiceList } from '../../shared/ui/ChoiceList.tsx';
import { Notice } from '../../shared/ui/Notice.tsx';
import { Page } from '../../shared/ui/Page.tsx';
import { ScreenHeader } from '../../shared/ui/ScreenHeader.tsx';
import { ScreenState } from '../../shared/ui/ScreenState.tsx';
import { Skeleton } from '../../shared/ui/Skeleton.tsx';
import { useToast } from '../../shared/ui/Toast.tsx';
import { GOAL_LABELS, GOALS, TAG_LABELS, type Goal } from '../../shared/vocabulary.ts';
import { ConsentText } from '../onboarding/OnboardingStep.tsx';
import {
  formFromProfile,
  grantedLine,
  profilePatch,
  RUSSIAN_TIME_ZONES,
  timeZoneLabel,
  updatedAgo,
  type ProfileForm,
} from './model.ts';
import styles from './Profile.module.css';

const GOAL_OPTIONS: { value: Goal | 'none'; label: string }[] = [
  ...GOALS.map((value) => ({ value, label: GOAL_LABELS[value] })),
  { value: 'none', label: 'Не выбрана' },
];

function deviceZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section} aria-label={title}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      {children}
    </section>
  );
}

const KCAL_STEP = 50;

function SettingsForm({ profile, children }: { profile: UserProfile; children: ReactNode }) {
  const toast = useToast();
  const online = useOnline();
  const update = useUpdateProfile();
  const zoneId = useId();
  const zoneErrorId = useId();
  const [form, setForm] = useState<ProfileForm>(() => formFromProfile(profile));
  const [errors, setErrors] = useState<{ kcalTarget?: string; goal?: string; timezone?: string }>({});
  const [editingKcal, setEditingKcal] = useState(false);
  const device = deviceZone();

  const latest = formFromProfile(profile);
  const [base, setBase] = useState(latest);
  if (
    base.kcalTarget !== latest.kcalTarget ||
    base.goal !== latest.goal ||
    base.timezone !== latest.timezone
  ) {
    setBase(latest);
    setForm((current) => ({
      kcalTarget: current.kcalTarget === base.kcalTarget ? latest.kcalTarget : current.kcalTarget,
      goal: current.goal === base.goal ? latest.goal : current.goal,
      timezone: current.timezone === base.timezone ? latest.timezone : current.timezone,
    }));
  }

  const checked = validateKcalTarget(form.kcalTarget);
  const target =
    typeof checked === 'number' && checked !== profile.kcalTarget && checked % KCAL_STEP !== 0
      ? `Укажите значение, кратное ${KCAL_STEP}`
      : checked;
  const patch =
    typeof target === 'number'
      ? profilePatch({ kcalTarget: target, goal: form.goal, timezone: form.timezone }, profile)
      : null;
  const dirty = patch === null || Object.keys(patch).length > 0;

  const save = () => {
    if (typeof target === 'string') {
      setErrors({ kcalTarget: target });
      setEditingKcal(true);
      return;
    }
    if (patch === null || Object.keys(patch).length === 0) return;
    setErrors({});
    update.mutate(patch, {
      onSuccess: () => {
        toast.show('Сохранено');
      },
      onError: (error) => {
        const fields = isApiError(error, 'validation_failed') ? error.fieldErrors : {};
        if (isApiError(error, 'invalid_timezone')) {
          setErrors({ timezone: userMessage(error) });
        } else if (
          fields.kcalTarget !== undefined ||
          fields.goal !== undefined ||
          fields.timezone !== undefined
        ) {
          setErrors({ kcalTarget: fields.kcalTarget, goal: fields.goal, timezone: fields.timezone });
          if (fields.kcalTarget !== undefined) setEditingKcal(true);
        } else if (!isApiError(error, 'consent_required')) {
          toast.show(userMessage(error), { tone: 'error' });
        }
      },
    });
  };

  return (
    <>
      <Section title="Ориентир калорий">
        <p className={styles.value}>{formatKcal(profile.kcalTarget)} в день</p>
        {editingKcal ? (
          <KcalTargetPicker
            value={form.kcalTarget}
            onChange={(value) => {
              setForm((current) => ({ ...current, kcalTarget: value }));
              setErrors({});
            }}
            error={errors.kcalTarget}
          />
        ) : (
          <button
            type="button"
            className={styles.inlineButton}
            onClick={() => {
              setEditingKcal(true);
            }}
          >
            Изменить
          </button>
        )}
        <Link to="/profile/target" className={styles.link}>
          Рассчитать
        </Link>
      </Section>
      <Section title="Цель">
        <ChoiceList
          legend="Цель"
          legendHidden
          options={GOAL_OPTIONS}
          value={form.goal ?? 'none'}
          onChange={(value) => {
            setForm((current) => ({ ...current, goal: value === 'none' ? null : value }));
            setErrors({});
          }}
          error={errors.goal}
        />
      </Section>
      {children}
      <Section title="Часовой пояс">
        <label className={styles.label} htmlFor={zoneId}>
          Часовой пояс дневника
        </label>
        <select
          id={zoneId}
          className={styles.select}
          value={form.timezone}
          aria-invalid={errors.timezone !== undefined}
          aria-describedby={errors.timezone !== undefined ? zoneErrorId : undefined}
          onChange={(event) => {
            setForm((current) => ({ ...current, timezone: event.target.value }));
            setErrors({});
          }}
        >
          {!RUSSIAN_TIME_ZONES.some((item) => item.zone === form.timezone) && (
            <option value={form.timezone}>{form.timezone}</option>
          )}
          {RUSSIAN_TIME_ZONES.map((item) => (
            <option key={item.zone} value={item.zone}>
              {item.label}
            </option>
          ))}
        </select>
        {errors.timezone !== undefined && (
          <p id={zoneErrorId} className={styles.error}>
            {errors.timezone}
          </p>
        )}
        {device !== null && device !== form.timezone && (
          <button
            type="button"
            className={styles.inlineButton}
            onClick={() => {
              setForm((current) => ({ ...current, timezone: device }));
            }}
          >
            Использовать часовой пояс устройства: {timeZoneLabel(device)}
          </button>
        )}
      </Section>
      <ActionBar>
        <Button size="large" stretched disabled={!dirty || !online} loading={update.isPending} onClick={save}>
          Сохранить
        </Button>
      </ActionBar>
    </>
  );
}

function LocationSection({ profile }: { profile: UserProfile }) {
  const geo = useGeolocation();
  const save = useSaveLocation();
  const { refetch } = useProfile();
  const toast = useToast();
  const [failed, setFailed] = useState(false);
  const [seenUpdate, setSeenUpdate] = useState(profile.locationUpdatedAt);
  if (seenUpdate !== profile.locationUpdatedAt) {
    setSeenUpdate(profile.locationUpdatedAt);
    setFailed(false);
  }

  useEffect(() => {
    if (!failed) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refetch();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [failed, refetch]);

  const refresh = async () => {
    setFailed(false);
    const point = await geo.request();
    if (point === null) {
      setFailed(true);
      return;
    }
    setDevicePoint(point);
    save.mutate(point, {
      onSuccess: () => {
        toast.show('Геопозиция обновлена');
      },
      onError: (error) => {
        toast.show(userMessage(error), { tone: 'error' });
      },
    });
  };

  return (
    <Section title="Местоположение">
      <p className={styles.value}>
        {profile.location === null || profile.locationUpdatedAt === null
          ? 'Не указано'
          : `Обновлено ${updatedAgo(profile.locationUpdatedAt, new Date())}, точность около 1 км`}
      </p>
      {profile.location === null && (
        <p className={styles.muted}>Без местоположения подборка ищет по всему городу.</p>
      )}
      {failed && (
        <Notice tone="error">
          Не получилось определить геопозицию. Отправьте её в чате с ботом: команда /profile, пункт обновления
          геопозиции.
          <button
            type="button"
            className={styles.inlineButton}
            onClick={() => {
              openMaxLink(botLink());
            }}
          >
            Перейти в чат с ботом
          </button>
        </Notice>
      )}
      <div className={styles.row}>
        <Button
          size="medium"
          variant="secondary"
          stretched
          loading={geo.status === 'requesting' || (save.isPending && save.variables !== null)}
          disabled={save.isPending && save.variables === null}
          onClick={() => {
            void refresh();
          }}
        >
          Обновить
        </Button>
        {profile.location !== null && (
          <Button
            size="medium"
            variant="secondary"
            stretched
            loading={save.isPending && save.variables === null}
            disabled={geo.status === 'requesting' || save.isPending}
            onClick={() => {
              save.mutate(null, {
                onSuccess: () => {
                  setDevicePoint(null);
                  toast.show('Местоположение удалено');
                },
                onError: (error) => {
                  toast.show(userMessage(error), { tone: 'error' });
                },
              });
            }}
          >
            Удалить
          </Button>
        )}
      </div>
    </Section>
  );
}

function ConsentsSection({ profile }: { profile: UserProfile }) {
  const toast = useToast();
  const consents = useConsents();
  const grant = useGrantConsent();
  const revoke = useRevokeConsent();
  const [sheet, setSheet] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const offers = consents.data?.find((item) => item.kind === 'personalized_offers');
  const personal = profile.consents.personalData;
  const offersOn = profile.consents.personalizedOffers.granted;

  const agree = () => {
    if (offers === undefined) return;
    setNotice(null);
    grant.mutate(
      { kind: 'personalized_offers', version: offers.version },
      {
        onSuccess: () => {
          setSheet(false);
          toast.show('Предложения в чате включены');
        },
        onError: (error) => {
          if (isApiError(error, 'consent_version_outdated')) {
            setNotice('Текст согласия обновился, прочитайте и подтвердите его снова');
            void consents.refetch();
            return;
          }
          setNotice(userMessage(error));
        },
      },
    );
  };

  return (
    <Section title="Согласия">
      <div className={styles.card}>
        <p className={styles.cardTitle}>Обработка персональных данных</p>
        <p className={styles.muted}>{grantedLine(personal.grantedAt, personal.version)}</p>
        <Link to="/profile/consents/personal_data" className={styles.link}>
          Прочитать текст
        </Link>
        <p className={styles.muted}>
          Чтобы отозвать согласие на обработку данных,{' '}
          <Link to="/profile/delete" className={styles.link}>
            удалите аккаунт
          </Link>
          .
        </p>
      </div>
      <div className={styles.card}>
        <label className={styles.switchRow}>
          <span className={styles.cardTitle}>Персональные предложения в чате</span>
          <Switch
            checked={offersOn && !revoke.isPending}
            disabled={grant.isPending || revoke.isPending}
            onChange={(event) => {
              if (event.target.checked) {
                setNotice(null);
                setSheet(true);
                return;
              }
              revoke.mutate('personalized_offers', {
                onSuccess: () => {
                  toast.show('Предложения в чате отключены');
                },
                onError: (error) => {
                  toast.show(userMessage(error), { tone: 'error' });
                },
              });
            }}
          />
        </label>
        <p className={styles.muted}>
          Подборки блюд в мини-приложении по вашему запросу доступны всегда. Согласие нужно только для
          сообщений бота с предложениями, не больше двух в день.
        </p>
      </div>
      <BottomSheet
        open={sheet}
        title={offers?.title ?? 'Персональные предложения'}
        onClose={() => {
          setSheet(false);
        }}
      >
        {consents.isError && offers === undefined ? (
          <Notice tone="error">
            {userMessage(consents.error)}
            <button
              type="button"
              className={styles.inlineButton}
              onClick={() => {
                void consents.refetch();
              }}
            >
              Повторить
            </button>
          </Notice>
        ) : offers === undefined ? (
          <Skeleton height={18} count={4} />
        ) : (
          <>
            <ConsentText text={offers.text} />
            {notice !== null && <Notice tone="error">{notice}</Notice>}
            <div className={styles.sheetActions}>
              <Button size="large" stretched loading={grant.isPending} onClick={agree}>
                Согласен
              </Button>
            </div>
          </>
        )}
      </BottomSheet>
    </Section>
  );
}

export function ProfileScreen() {
  const navigate = useNavigate();
  const profile = useProfile();
  const data = profile.data;
  return (
    <Page>
      <ScreenHeader title="Профиль" />
      {profile.isPending && <Skeleton height={64} count={4} />}
      {profile.isError && data === undefined && (
        <ScreenState
          status="error"
          title="Не удалось загрузить профиль"
          description={userMessage(profile.error)}
          action={{
            label: 'Повторить',
            onClick: () => {
              void profile.refetch();
            },
          }}
        />
      )}
      {data !== undefined && (
        <>
          <SettingsForm profile={data}>
            <Section title="Не предлагать">
              <p className={styles.value}>
                {data.dislikedTags.length === 0
                  ? 'Ничего не исключено'
                  : data.dislikedTags.map((tag) => TAG_LABELS[tag]).join(', ')}
              </p>
              <Link to="/profile/tags" className={styles.link}>
                Изменить
              </Link>
            </Section>
            <LocationSection profile={data} />
          </SettingsForm>
          <ConsentsSection profile={data} />
          <Section title="Кабинет заведения">
            <Button
              size="medium"
              variant="secondary"
              stretched
              onClick={() => {
                void navigate('/venue');
              }}
            >
              Открыть кабинет
            </Button>
          </Section>
          <Section title="О сервисе">
            <p className={styles.muted}>
              Оценки калорийности приблизительные и не являются медицинской рекомендацией. Оператор данных:
              команда проекта «ППшкин», связь через чат с ботом.
            </p>
          </Section>
          <Section title="Удалить аккаунт">
            <p className={styles.muted}>
              Профиль, дневник и согласия будут удалены без возможности восстановления.
            </p>
            <Button
              size="medium"
              variant="destructive"
              stretched
              onClick={() => {
                void navigate('/profile/delete');
              }}
            >
              Удалить аккаунт
            </Button>
          </Section>
        </>
      )}
    </Page>
  );
}
