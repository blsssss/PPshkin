import { Button } from '@maxhub/max-ui';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { isApiError } from '../../api/errors.ts';
import { userMessage } from '../../api/messages.ts';
import { canScanQr, haptic, scanQrCode } from '../../max/bridge.ts';
import { formatPrice, plural } from '../../shared/format.ts';
import { useNow } from '../../shared/useNow.ts';
import { zonedDate } from '../../shared/zonedTime.ts';
import { BarChart } from '../../shared/ui/BarChart.tsx';
import { ConfirmSheet } from '../../shared/ui/ConfirmSheet.tsx';
import { Field } from '../../shared/ui/Field.tsx';
import { Label } from '../../shared/ui/Label.tsx';
import { Notice } from '../../shared/ui/Notice.tsx';
import { Page } from '../../shared/ui/Page.tsx';
import { ScreenHeader } from '../../shared/ui/ScreenHeader.tsx';
import { ScreenState } from '../../shared/ui/ScreenState.tsx';
import { SegmentedControl } from '../../shared/ui/SegmentedControl.tsx';
import { Skeleton } from '../../shared/ui/Skeleton.tsx';
import { HISTORY_LABELS, type Booking } from '../bookings/model.ts';
import { dayOfMonth, formatLongDate, shiftDate } from '../diary/dates.ts';
import { cleanCodeInput, formatRate, normalizeBookingCode, venueClock } from './dealModel.ts';
import { useRedeem, useVenueAnalytics, useVenueBookings } from './dealQueries.ts';
import type { Venue } from './model.ts';
import { useVenue, useVenueNotFoundRedirect } from './queries.ts';
import styles from './Venue.module.css';
import { useOnline } from '../../shared/useOnline.ts';

const SOON_MS = 10 * 60_000;

const REDEEM_ERRORS: Record<string, string> = {
  booking_not_found: 'Бронь с таким кодом не найдена в вашем заведении',
  booking_expired: 'Срок брони истёк. Гость может оформить новую',
  booking_not_active: 'Бронь уже погашена или отменена',
};

function redeemError(error: unknown): string {
  return isApiError(error) ? (REDEEM_ERRORS[error.code] ?? userMessage(error)) : userMessage(error);
}

function ActiveRow({ booking, venue }: { booking: Booking; venue: Venue }) {
  const redeem = useRedeem();
  const online = useOnline();
  const [confirm, setConfirm] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const left = new Date(booking.expiresAt).getTime() - useNow();
  const minutes = Math.max(0, Math.ceil(left / 60_000));
  return (
    <li className={styles.reviewRow}>
      <div className={styles.reviewHead}>
        <div className={styles.reviewSummary}>
          <span className={styles.bookingCode}>{booking.code}</span>
          <span className={styles.itemName}>{booking.item.name}</span>
          <span className={styles.meta}>
            {formatPrice(booking.priceRub)}, до {venueClock(booking.expiresAt, venue.timezone)}, осталось{' '}
            {minutes} {plural(minutes, ['минута', 'минуты', 'минут'])}
          </span>
          <span className={styles.badges}>
            {booking.dealId !== null && <Label tone="pink">Горящее предложение</Label>}
            {left < SOON_MS && <Label tone="blue">Скоро истечёт</Label>}
          </span>
        </div>
      </div>
      {notice !== null && <Notice tone="error">{notice}</Notice>}
      <div className={styles.actions}>
        <Button
          size="medium"
          stretched
          disabled={!online}
          aria-label={`Погасить ${booking.code}`}
          onClick={() => {
            setNotice(null);
            setConfirm(true);
          }}
        >
          Погасить
        </Button>
      </div>
      <ConfirmSheet
        open={confirm}
        title={`Погасить бронь ${booking.code}: ${booking.item.name}, ${formatPrice(booking.priceRub)}?`}
        confirmLabel="Погасить"
        onCancel={() => {
          setConfirm(false);
        }}
        onConfirm={async () => {
          try {
            await redeem.mutateAsync(booking.code);
            haptic.success();
          } catch (error) {
            haptic.error();
            setNotice(redeemError(error));
          }
          setConfirm(false);
        }}
      />
    </li>
  );
}

export function VenueBookingsScreen() {
  const navigate = useNavigate();
  const venue = useVenue();
  useVenueNotFoundRedirect();
  const [tab, setTab] = useState<'active' | 'history'>('active');
  const [date, setDate] = useState('');
  const data = venue.data;
  const today = data === undefined || data === null ? '' : zonedDate(new Date(), data.timezone);
  const list = useVenueBookings(tab, tab === 'history' && date.length > 0 ? date : null);
  const items = list.data ?? [];
  return (
    <Page>
      <ScreenHeader title="Брони" back="/venue" />
      <div className={styles.group}>
        <SegmentedControl
          label="Брони"
          options={[
            { value: 'active', label: 'Активные' },
            { value: 'history', label: 'История' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>
      <div className={styles.row}>
        {tab === 'active' ? (
          <Button
            size="medium"
            variant="secondary"
            stretched
            loading={list.isFetching}
            onClick={() => {
              void list.refetch();
            }}
          >
            Обновить
          </Button>
        ) : (
          <Field
            label="День"
            type="date"
            value={date}
            max={today}
            onChange={(event) => {
              setDate(event.target.value);
            }}
          />
        )}
        <Button
          size="medium"
          stretched
          onClick={() => {
            void navigate('/venue/redeem');
          }}
        >
          Погасить по коду
        </Button>
      </div>
      {(list.isPending || venue.isPending) && <Skeleton height={96} count={3} />}
      {list.isError && list.data === undefined && (
        <ScreenState
          status="error"
          title="Не удалось загрузить брони"
          description={userMessage(list.error)}
          error={list.error}
          action={{
            label: 'Повторить',
            onClick: () => {
              void list.refetch();
            },
          }}
        />
      )}
      {list.data !== undefined && items.length === 0 && (
        <p className={styles.muted}>
          {tab === 'active' ? 'Активных броней нет.' : 'За этот период броней нет.'}
        </p>
      )}
      {items.length > 0 && data !== undefined && data !== null && (
        <ul className={styles.review} aria-live="polite">
          {items.map((booking) =>
            tab === 'active' ? (
              <ActiveRow key={booking.id} booking={booking} venue={data} />
            ) : (
              <li key={booking.id} className={styles.reviewRow}>
                <div className={styles.reviewHead}>
                  <div className={styles.reviewSummary}>
                    <span className={styles.bookingCode}>{booking.code}</span>
                    <span className={styles.itemName}>{booking.item.name}</span>
                    <span className={styles.meta}>
                      {formatPrice(booking.priceRub)},{' '}
                      {new Intl.DateTimeFormat('ru-RU', {
                        timeZone: data.timezone,
                        day: 'numeric',
                        month: 'long',
                        hour: '2-digit',
                        minute: '2-digit',
                      }).format(new Date(booking.resolvedAt ?? booking.createdAt))}
                    </span>
                  </div>
                  {booking.status !== 'active' && (
                    <Label tone={booking.status === 'redeemed' ? 'violet' : 'blue'}>
                      {booking.status === 'redeemed' ? 'Погашена' : HISTORY_LABELS[booking.status]}
                    </Label>
                  )}
                </div>
              </li>
            ),
          )}
        </ul>
      )}
    </Page>
  );
}

export function RedeemScreen() {
  const navigate = useNavigate();
  useVenueNotFoundRedirect();
  const redeem = useRedeem();
  const online = useOnline();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [scanFailed, setScanFailed] = useState(false);
  const [done, setDone] = useState<Booking | null>(null);
  const scanner = canScanQr();

  const submit = (value: string) => {
    if (redeem.isPending) return;
    setError(null);
    setScanFailed(false);
    const normalized = normalizeBookingCode(value);
    if (normalized === null) {
      setError('Это не QR брони ППшкин');
      return;
    }
    redeem.mutate(normalized, {
      onSuccess: (booking) => {
        haptic.success();
        setDone(booking);
        setCode('');
      },
      onError: (failure) => {
        haptic.error();
        setError(redeemError(failure));
      },
    });
  };

  const scan = () => {
    haptic.impact('light');
    setError(null);
    setScanFailed(false);
    void scanQrCode().then((result) => {
      if (result.status === 'scanned') submit(result.value);
      else setScanFailed(true);
    });
  };

  if (done !== null) {
    return (
      <Page>
        <ScreenHeader title="Погашение" back="/venue" />
        <ScreenState
          status="empty"
          title="Погашено"
          description={`${done.item.name}, ${formatPrice(done.priceRub)}, код ${done.code}`}
          action={{
            label: 'Сканировать следующий',
            onClick: () => {
              setDone(null);
              if (scanner) scan();
            },
          }}
          secondaryAction={{
            label: 'К броням',
            onClick: () => {
              void navigate('/venue/bookings');
            },
          }}
        />
      </Page>
    );
  }

  return (
    <Page>
      <ScreenHeader title="Погашение" back="/venue" />
      {scanner && (
        <div className={styles.actions}>
          <Button size="large" stretched disabled={redeem.isPending || !online} onClick={scan}>
            Сканировать QR гостя
          </Button>
        </div>
      )}
      {scanFailed && (
        <Notice tone="error">
          Не удалось отсканировать.{' '}
          <button type="button" className={styles.inlineButton} disabled={redeem.isPending} onClick={scan}>
            Ещё раз
          </button>{' '}
          <button
            type="button"
            className={styles.inlineButton}
            onClick={() => {
              setScanFailed(false);
              document.querySelector<HTMLInputElement>('input[name="booking-code"]')?.focus();
            }}
          >
            Ввести код
          </button>
        </Notice>
      )}
      {!online && (
        <p className={styles.error} role="status">
          Нет соединения с интернетом, отправьте, когда сеть появится
        </p>
      )}
      <h2 className={styles.sectionTitle}>Ввести код</h2>
      <Field
        label="Код брони"
        name="booking-code"
        value={code}
        autoCapitalize="characters"
        autoComplete="off"
        maxLength={6}
        onChange={(event) => {
          setCode(cleanCodeInput(event.target.value));
          setError(null);
        }}
        hint="В коде нет букв I и O и цифр 0 и 1"
        error={error ?? undefined}
      />
      <div className={styles.actions}>
        <Button
          size="large"
          stretched
          loading={redeem.isPending}
          disabled={code.length !== 6 || !online}
          onClick={() => {
            submit(code);
          }}
        >
          Погасить
        </Button>
      </div>
    </Page>
  );
}

type Period = 'today' | '7' | '30';

function periodRange(period: Period, timeZone: string): { from: string; to: string } {
  const today = zonedDate(new Date(), timeZone);
  const days = period === 'today' ? 1 : Number(period);
  return { from: shiftDate(today, -(days - 1)), to: today };
}

function Tile({ title, value, meta }: { title: string; value: string; meta?: string }) {
  return (
    <li className={styles.tile}>
      <span className={styles.meta}>{title}</span>
      <span className={styles.tileValue}>{value}</span>
      {meta !== undefined && <span className={styles.meta}>{meta}</span>}
    </li>
  );
}

function Analytics({ venue }: { venue: Venue }) {
  const navigate = useNavigate();
  const [period, setPeriod] = useState<Period>('7');
  const [periodNotice, setPeriodNotice] = useState(false);
  const range = periodRange(period, venue.timezone);
  const analytics = useVenueAnalytics(range);
  const data = analytics.data;

  if (analytics.isError && isApiError(analytics.error, 'invalid_period') && period !== '7') {
    setPeriod('7');
    setPeriodNotice(true);
  }

  const empty =
    data?.offersShown === 0 &&
    data.bookingsCreated === 0 &&
    data.revenueRub === 0 &&
    data.surplusUnitsSold === 0;

  return (
    <>
      <div className={styles.group}>
        <SegmentedControl
          label="Период"
          options={[
            { value: 'today', label: 'Сегодня' },
            { value: '7', label: '7 дней' },
            { value: '30', label: '30 дней' },
          ]}
          value={period}
          onChange={(value) => {
            setPeriod(value);
            setPeriodNotice(false);
          }}
        />
      </div>
      {data !== undefined && (
        <p className={styles.muted}>
          {data.from === data.to
            ? formatLongDate(data.from)
            : `${formatLongDate(data.from)} - ${formatLongDate(data.to)}`}
        </p>
      )}
      {periodNotice && <Notice tone="error">Неверный период, показываем 7 дней</Notice>}
      {analytics.isPending && <Skeleton height={72} count={4} />}
      {analytics.isError && data === undefined && (
        <ScreenState
          status="error"
          title={
            isApiError(analytics.error, 'invalid_period')
              ? 'Неверный период'
              : 'Не удалось загрузить статистику'
          }
          description={userMessage(analytics.error)}
          error={analytics.error}
          action={{
            label: 'Повторить',
            onClick: () => {
              void analytics.refetch();
            },
          }}
        />
      )}
      {empty && (
        <ScreenState
          status="empty"
          title="Данных пока нет"
          description="Опубликуйте горящую позицию, и здесь появятся брони и выручка."
          action={{
            label: 'Добавить горящую позицию',
            onClick: () => {
              void navigate('/venue/deals/new');
            },
          }}
        />
      )}
      {data !== undefined && !empty && (
        <>
          <ul className={styles.tiles}>
            <Tile title="Выручка через ППшкин" value={formatPrice(data.revenueRub)} />
            <Tile
              title="Продано вместо списания"
              value={`${String(data.surplusUnitsSold)} шт.`}
              meta={`на ${formatPrice(data.surplusRevenueRub)}`}
            />
            <Tile
              title="Брони"
              value={`${String(data.bookingsCreated)} создано`}
              meta={`${String(data.bookingsRedeemed)} погашено, ${String(data.bookingsExpired)} истекло, ${String(data.bookingsCancelled)} отменено`}
            />
            <Tile
              title="Показы в рекомендациях"
              value={String(data.offersShown)}
              meta={`принято ${String(data.offersAccepted)} (${formatRate(data.acceptRate, data.offersShown)})`}
            />
            <Tile title="Доля погашенных броней" value={formatRate(data.redeemRate, data.bookingsCreated)} />
          </ul>
          <h2 className={styles.sectionTitle}>Погашено по дням</h2>
          <BarChart
            title="Погашенные брони по дням"
            bars={data.byDay.map((day) => ({
              key: day.date,
              value: day.bookingsRedeemed,
              label: `${formatLongDate(day.date)}: погашено ${String(day.bookingsRedeemed)}, выручка ${formatPrice(day.revenueRub)}`,
              caption: data.byDay.length <= 7 ? formatLongDate(day.date).slice(0, 2) : dayOfMonth(day.date),
            }))}
          />
          {data.topItems.length > 0 && (
            <>
              <h2 className={styles.sectionTitle}>Чаще всего забирают</h2>
              <ul className={styles.items}>
                {data.topItems.map((item) => (
                  <li key={item.menuItemId} className={styles.item}>
                    <span className={styles.itemMain}>
                      <span className={styles.itemName}>{item.name}</span>
                      <span className={styles.meta}>
                        {item.redeemed} шт., {formatPrice(item.revenueRub)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </>
  );
}

export function AnalyticsScreen() {
  const venue = useVenue();
  useVenueNotFoundRedirect();
  const data = venue.data;
  return (
    <Page>
      <ScreenHeader title="Статистика" back="/venue" />
      {venue.isPending && <Skeleton height={72} count={4} />}
      {data !== undefined && data !== null && <Analytics venue={data} />}
    </Page>
  );
}
