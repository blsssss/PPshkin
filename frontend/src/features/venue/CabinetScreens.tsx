import { Button } from '@maxhub/max-ui';
import { useEffect, useId, useState } from 'react';
import { useNavigate } from 'react-router';
import { isApiError } from '../../api/errors.ts';
import { userMessage } from '../../api/messages.ts';
import { buildStartAppLink } from '../../app/startParam.ts';
import { haptic, openExternalLink } from '../../max/bridge.ts';
import { plural } from '../../shared/format.ts';
import { useGeolocation } from '../../shared/geo/useGeolocation.ts';
import { isOpenNow } from '../../shared/openNow.ts';
import { useOnline } from '../../shared/useOnline.ts';
import { useUnsavedChanges } from '../../shared/useUnsavedChanges.tsx';
import { ActionBar } from '../../shared/ui/ActionBar.tsx';
import { ChoiceList } from '../../shared/ui/ChoiceList.tsx';
import { Field } from '../../shared/ui/Field.tsx';
import { Label } from '../../shared/ui/Label.tsx';
import { Notice } from '../../shared/ui/Notice.tsx';
import { Page } from '../../shared/ui/Page.tsx';
import { ScreenHeader } from '../../shared/ui/ScreenHeader.tsx';
import { ScreenState } from '../../shared/ui/ScreenState.tsx';
import { ShareButton } from '../../shared/ui/ShareButton.tsx';
import { Skeleton } from '../../shared/ui/Skeleton.tsx';
import { useToast } from '../../shared/ui/Toast.tsx';
import { VENUE_CATEGORY_LABELS, type VenueCategory } from '../../shared/vocabulary.ts';
import { mapsLink } from '../eat/model.ts';
import { RUSSIAN_TIME_ZONES } from '../profile/model.ts';
import {
  emptyVenueForm,
  formatCoordinates,
  parseCoordinates,
  validateVenue,
  venueFieldFromPath,
  venueFormFrom,
  venuePatch,
  type Venue,
  type VenueField,
  type VenueForm,
  type VenueInput,
} from './model.ts';
import { useVenueBookings, useVenueDeals } from './dealQueries.ts';
import { useReloadVenue, useSaveVenue, useVenue, useVenueMenu, useVenueNotFoundRedirect } from './queries.ts';
import styles from './Venue.module.css';
import { useLeave } from '../../shared/appHistory.ts';

const CATEGORY_OPTIONS = (Object.keys(VENUE_CATEGORY_LABELS) as VenueCategory[]).map((value) => ({
  value,
  label: VENUE_CATEGORY_LABELS[value],
}));

function VenueLoadError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <ScreenState
      status="error"
      title="Не удалось загрузить заведение"
      description={userMessage(error)}
      error={error}
      action={{ label: 'Повторить', onClick: retry }}
    />
  );
}

function Tile({ title, meta, to }: { title: string; meta?: string; to: string }) {
  const navigate = useNavigate();
  return (
    <li>
      <button
        type="button"
        className={styles.tile}
        onClick={() => {
          void navigate(to);
        }}
      >
        <span className={styles.tileTitle}>{title}</span>
        {meta !== undefined && <span className={styles.meta}>{meta}</span>}
      </button>
    </li>
  );
}

function countMeta(count: number | undefined, forms: readonly [string, string, string]): string | undefined {
  if (count === undefined) return undefined;
  return count === 0 ? 'Нет активных' : `${String(count)} ${plural(count, forms)}`;
}

function VenueHome({ venue }: { venue: Venue }) {
  const navigate = useNavigate();
  const menu = useVenueMenu();
  const deals = useVenueDeals('active');
  const bookings = useVenueBookings('active', null, false);
  const open = isOpenNow(venue.opensAt, venue.closesAt, venue.timezone, new Date());
  const count = menu.data?.length;
  return (
    <>
      <section className={styles.head} aria-label="Заведение">
        <p className={styles.meta}>
          {VENUE_CATEGORY_LABELS[venue.category]}, {venue.address}
        </p>
        <div className={styles.badges}>
          <Label tone="blue">
            {venue.opensAt}-{venue.closesAt}
          </Label>
          <Label tone={open ? 'violet' : 'pink'}>{open ? 'Открыто сейчас' : 'Закрыто'}</Label>
          {venue.isDemo && <Label tone="cyan">Заведение и меню тестовые</Label>}
        </div>
      </section>
      <div className={styles.actions}>
        <Button
          size="large"
          stretched
          onClick={() => {
            void navigate('/venue/redeem');
          }}
        >
          Погасить бронь
        </Button>
      </div>
      <ul className={styles.tiles}>
        <Tile
          title="Горящие позиции"
          to="/venue/deals"
          meta={countMeta(deals.data?.length, ['активная', 'активные', 'активных'])}
        />
        <Tile
          title="Брони"
          to="/venue/bookings"
          meta={countMeta(bookings.data?.length, ['активная', 'активные', 'активных'])}
        />
        <Tile title="Статистика" meta="Выручка, брони и показы" to="/venue/analytics" />
        <Tile
          title="Меню"
          to="/venue/menu"
          meta={
            count === undefined
              ? undefined
              : count === 0
                ? 'Пока пустое'
                : `${String(count)} ${plural(count, ['позиция', 'позиции', 'позиций'])}`
          }
        />
        <Tile title="Настройки заведения" meta="Название, адрес, часы работы" to="/venue/settings" />
        <Tile title="Ссылка для гостей" meta="QR на стол или витрину" to="/venue/link" />
      </ul>
    </>
  );
}

export function VenueHomeScreen() {
  const navigate = useNavigate();
  const venue = useVenue();
  useVenueNotFoundRedirect();
  const data = venue.data;
  return (
    <Page>
      <ScreenHeader title={data?.name ?? 'Моё заведение'} />
      {venue.isPending && <Skeleton height={72} count={3} />}
      {venue.isError && (
        <VenueLoadError
          error={venue.error}
          retry={() => {
            void venue.refetch();
          }}
        />
      )}
      {data === null && (
        <ScreenState
          status="empty"
          title="У вас пока нет заведения"
          description="Заведите заведение и меню, чтобы гости видели ваши блюда и горящие позиции."
          action={{
            label: 'Создать заведение',
            onClick: () => {
              void navigate('/venue/settings');
            },
          }}
        />
      )}
      {data !== undefined && data !== null && <VenueHome venue={data} />}
    </Page>
  );
}

function sameForm(a: VenueForm, b: VenueForm): boolean {
  return (Object.keys(a) as VenueField[]).every((key) => a[key] === b[key]);
}

function VenueSettingsForm({ venue }: { venue: Venue | null }) {
  const leave = useLeave();
  const toast = useToast();
  const online = useOnline();
  const save = useSaveVenue();
  const reload = useReloadVenue();
  const geo = useGeolocation({ highAccuracy: true });
  const zoneId = useId();
  const [initial] = useState(() => (venue === null ? emptyVenueForm() : venueFormFrom(venue)));
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<Partial<Record<VenueField, string>>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [geoFailed, setGeoFailed] = useState(false);
  const dirty = !sameForm(form, initial);
  const { prompt, release } = useUnsavedChanges(dirty);
  const point = parseCoordinates(form.coordinates);

  const set = <K extends VenueField>(key: K, value: VenueForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const locate = async () => {
    setGeoFailed(false);
    const found = await geo.request();
    if (found === null) setGeoFailed(true);
    else set('coordinates', formatCoordinates(found));
  };

  const submit = () => {
    const result = validateVenue(form);
    setErrors(result.errors);
    setNotice(null);
    if (result.input === null) return;
    const request: { create: VenueInput } | { patch: Partial<VenueInput> } =
      venue === null ? { create: result.input } : { patch: venuePatch(result.input, venue) };
    if ('patch' in request && Object.keys(request.patch).length === 0) {
      release();
      leave('/venue');
      return;
    }
    save.mutate(request, {
      onSuccess: () => {
        release();
        toast.show(venue === null ? 'Заведение создано' : 'Сохранено');
        leave('/venue');
      },
      onError: (error) => {
        haptic.error();
        if (isApiError(error, 'venue_exists')) {
          release();
          toast.show(userMessage(error), { tone: 'error' });
          void reload().then(() => {
            leave('/venue');
          });
          return;
        }
        if (isApiError(error, 'invalid_timezone')) {
          setErrors({ timezone: userMessage(error) });
          return;
        }
        if (isApiError(error, 'validation_failed')) {
          const mapped: Partial<Record<VenueField, string>> = {};
          for (const [path, message] of Object.entries(error.fieldErrors)) {
            const field = venueFieldFromPath(path);
            if (field !== null) mapped[field] ??= message;
          }
          if (Object.keys(mapped).length > 0) {
            setErrors(mapped);
            return;
          }
        }
        setNotice(userMessage(error));
      },
    });
  };

  return (
    <>
      <Field
        label="Название"
        value={form.name}
        maxLength={120}
        onChange={(event) => {
          set('name', event.target.value);
        }}
        error={errors.name}
      />
      <Field
        label="Адрес"
        value={form.address}
        maxLength={200}
        onChange={(event) => {
          set('address', event.target.value);
        }}
        error={errors.address}
      />
      <ChoiceList
        legend="Категория"
        options={CATEGORY_OPTIONS}
        value={form.category}
        onChange={(value) => {
          set('category', value);
        }}
        error={errors.category}
      />
      <h2 className={styles.sectionTitle}>Где находится</h2>
      <Field
        label="Координаты"
        value={form.coordinates}
        inputMode="decimal"
        placeholder="55.7963, 49.1088"
        onChange={(event) => {
          set('coordinates', event.target.value);
        }}
        hint="Широта и долгота через запятую"
        error={errors.coordinates}
      />
      {geoFailed && (
        <Notice tone="error">Не удалось определить местоположение, введите координаты вручную</Notice>
      )}
      <div className={styles.actions}>
        <Button
          size="medium"
          variant="secondary"
          stretched
          loading={geo.status === 'requesting'}
          onClick={() => {
            void locate();
          }}
        >
          Определить по геопозиции
        </Button>
        <Button
          size="medium"
          variant="secondary"
          stretched
          disabled={point === null}
          onClick={() => {
            if (point !== null) openExternalLink(mapsLink(point));
          }}
        >
          Проверить на карте
        </Button>
      </div>
      <h2 className={styles.sectionTitle}>Часы работы</h2>
      <div className={styles.grid}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${zoneId}-opens`}>
            Открытие
          </label>
          <input
            id={`${zoneId}-opens`}
            className={styles.time}
            type="time"
            value={form.opensAt}
            aria-invalid={errors.opensAt !== undefined}
            onChange={(event) => {
              set('opensAt', event.target.value);
            }}
          />
          {errors.opensAt !== undefined && <p className={styles.error}>{errors.opensAt}</p>}
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${zoneId}-closes`}>
            Закрытие
          </label>
          <input
            id={`${zoneId}-closes`}
            className={styles.time}
            type="time"
            value={form.closesAt}
            aria-invalid={errors.closesAt !== undefined}
            onChange={(event) => {
              set('closesAt', event.target.value);
            }}
          />
          {errors.closesAt !== undefined && <p className={styles.error}>{errors.closesAt}</p>}
        </div>
      </div>
      <p className={styles.muted}>
        Если закрываетесь после полуночи, укажите время закрытия меньше времени открытия. Одинаковое время
        означает круглосуточную работу.
      </p>
      <div className={styles.field}>
        <label className={styles.label} htmlFor={zoneId}>
          Часовой пояс
        </label>
        <select
          id={zoneId}
          className={styles.select}
          value={form.timezone}
          aria-invalid={errors.timezone !== undefined}
          onChange={(event) => {
            set('timezone', event.target.value);
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
        {errors.timezone !== undefined && <p className={styles.error}>{errors.timezone}</p>}
      </div>
      {notice !== null && <Notice tone="error">{notice}</Notice>}
      <ActionBar sends>
        <Button size="large" stretched loading={save.isPending} disabled={!online} onClick={submit}>
          {venue === null ? 'Создать заведение' : 'Сохранить'}
        </Button>
      </ActionBar>
      {prompt}
    </>
  );
}

export function VenueSettingsScreen() {
  const venue = useVenue();
  return (
    <Page>
      <ScreenHeader title={venue.data === null ? 'Новое заведение' : 'Заведение'} back="/venue" />
      {venue.isPending && <Skeleton height={56} count={5} />}
      {venue.isError && (
        <VenueLoadError
          error={venue.error}
          retry={() => {
            void venue.refetch();
          }}
        />
      )}
      {venue.data !== undefined && <VenueSettingsForm venue={venue.data} />}
    </Page>
  );
}

function QrCode({ link }: { link: string }) {
  const [source, setSource] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    import('qrcode')
      .then(({ default: QRCode }) =>
        QRCode.toDataURL(link, { margin: 1, width: 560, errorCorrectionLevel: 'M' }),
      )
      .then(
        (url) => {
          if (active) setSource(url);
        },
        () => {
          if (active) setSource(null);
        },
      );
    return () => {
      active = false;
    };
  }, [link]);
  return (
    <div className={styles.qr}>
      {source === null ? (
        <Skeleton height={280} />
      ) : (
        <img src={source} alt="QR-код ссылки на заведение" width={280} height={280} />
      )}
    </div>
  );
}

async function copyLink(link: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(link);
    return true;
  } catch {
    return false;
  }
}

export function VenueLinkScreen() {
  const toast = useToast();
  const venue = useVenue();
  useVenueNotFoundRedirect();
  const linkId = useId();
  const data = venue.data;
  const link = data === undefined || data === null ? null : buildStartAppLink(`venue_${String(data.id)}`);
  return (
    <Page>
      <ScreenHeader title="Ссылка для гостей" back="/venue" />
      {venue.isPending && <Skeleton height={280} />}
      {venue.isError && (
        <VenueLoadError
          error={venue.error}
          retry={() => {
            void venue.refetch();
          }}
        />
      )}
      {data !== undefined && data !== null && link !== null && (
        <>
          <QrCode link={link} />
          <p className={styles.muted}>
            Распечатайте QR и поставьте на стол или витрину: гость откроет карточку заведения с горящими
            позициями.
          </p>
          <p id={linkId} className={styles.link}>
            {link}
          </p>
          <div className={styles.actions}>
            <ShareButton text={`${data.name}: меню и горящие позиции в ППшкин`} link={link} />
            <Button
              size="large"
              variant="secondary"
              stretched
              onClick={() => {
                void copyLink(link).then((copied) => {
                  if (copied) {
                    toast.show('Ссылка скопирована');
                    return;
                  }
                  const node = document.getElementById(linkId);
                  const selection = window.getSelection();
                  if (node !== null && selection !== null) {
                    selection.selectAllChildren(node);
                  }
                  toast.show('Выделили ссылку, скопируйте её вручную');
                });
              }}
            >
              Скопировать ссылку
            </Button>
          </div>
        </>
      )}
    </Page>
  );
}
