import { Button } from '@maxhub/max-ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { unwrap } from '../../api/client.ts';
import { ApiError, isApiError } from '../../api/errors.ts';
import { api } from '../../api/index.ts';
import { userMessage } from '../../api/messages.ts';
import { haptic, openExternalLink, requestMaxBrightness, restoreBrightness } from '../../max/bridge.ts';
import { formatKcal, formatPrice } from '../../shared/format.ts';
import { useNow } from '../../shared/useNow.ts';
import { ActionBar } from '../../shared/ui/ActionBar.tsx';
import { ConfirmSheet } from '../../shared/ui/ConfirmSheet.tsx';
import { Label } from '../../shared/ui/Label.tsx';
import { Notice } from '../../shared/ui/Notice.tsx';
import { Page } from '../../shared/ui/Page.tsx';
import { ScreenHeader } from '../../shared/ui/ScreenHeader.tsx';
import { ScreenState, type ScreenAction } from '../../shared/ui/ScreenState.tsx';
import { SegmentedControl } from '../../shared/ui/SegmentedControl.tsx';
import { Skeleton } from '../../shared/ui/Skeleton.tsx';
import { useToast } from '../../shared/ui/Toast.tsx';
import { mapsLink } from '../eat/model.ts';
import { DealPrice, DemoBadge } from '../eat/parts.tsx';
import {
  CREATE_ERRORS,
  formatCode,
  formatCountdown,
  HISTORY_LABELS,
  MAX_ACTIVE_BOOKINGS,
  msLeft,
  parseNewBooking,
  spelledCode,
  WARNING_MS,
  type Booking,
  type CreateAction,
  type NewBookingParams,
} from './model.ts';
import { useBooking, useBookingQr, useBookings, useCancelBooking, useCreateBooking } from './queries.ts';
import styles from './Bookings.module.css';

function Countdown({ expiresAt, className }: { expiresAt: string; className?: string }) {
  const left = msLeft(expiresAt, useNow());
  return (
    <p
      className={[styles.timer, left <= WARNING_MS ? styles.urgent : '', className ?? ''].join(' ').trim()}
      role="timer"
      aria-label={`Осталось ${formatCountdown(left)}`}
    >
      {formatCountdown(left)}
    </p>
  );
}

function Code({ code, className }: { code: string; className: string | undefined }) {
  return (
    <p className={className} role="img" aria-label={`Код брони ${spelledCode(code)}`}>
      {formatCode(code)}
    </p>
  );
}

function Unavailable({ text, venueId }: { text: string; venueId: number | null }) {
  const navigate = useNavigate();
  return (
    <ScreenState
      status="empty"
      title={text}
      action={{
        label: venueId === null ? 'Что поесть' : 'К заведению',
        onClick: () => {
          void navigate(venueId === null ? '/eat' : `/venues/${String(venueId)}`);
        },
      }}
      secondaryAction={
        venueId === null
          ? undefined
          : {
              label: 'Что поесть',
              onClick: () => {
                void navigate('/eat');
              },
            }
      }
    />
  );
}

function Confirm({ params }: { params: NewBookingParams }) {
  const navigate = useNavigate();
  const create = useCreateBooking();
  const [failure, setFailure] = useState<{ text: string; actions: readonly CreateAction[] } | null>(null);
  const details = useQuery({
    queryKey: ['venue-details', params.venueId],
    queryFn: async () =>
      unwrap(await api.GET('/api/v1/venues/{id}', { params: { path: { id: params.venueId } } })),
    staleTime: 0,
  });

  if (details.isPending) return <Skeleton height={120} count={2} />;
  if (details.isError) {
    return isApiError(details.error, 'venue_not_found') ? (
      <Unavailable text="Эта позиция больше недоступна" venueId={null} />
    ) : (
      <ScreenState
        status="error"
        title="Не удалось загрузить заведение"
        description={userMessage(details.error)}
        action={{
          label: 'Повторить',
          onClick: () => {
            void details.refetch();
          },
        }}
      />
    );
  }

  const { venue, menu, deals, openNow } = details.data;
  const item = menu.find((entry) => entry.id === params.menuItemId);
  const deal = params.dealId === null ? null : (deals.find((entry) => entry.id === params.dealId) ?? null);
  if (item === undefined || !item.isAvailable || (params.dealId !== null && deal === null)) {
    return <Unavailable text="Эта позиция больше недоступна" venueId={venue.id} />;
  }
  if (!openNow) return <Unavailable text="Заведение сейчас закрыто, бронь недоступна" venueId={venue.id} />;

  const act = (action: CreateAction): ScreenAction => {
    const go = (path: string) => () => {
      void navigate(path);
    };
    switch (action) {
      case 'bookings':
        return { label: 'Мои брони', onClick: go('/bookings') };
      case 'venue':
        return { label: 'К заведению', onClick: go(`/venues/${String(venue.id)}`) };
      case 'eat':
        return { label: 'Что поесть', onClick: go('/eat') };
      case 'refresh':
        return {
          label: 'Обновить',
          onClick: () => {
            setFailure(null);
            void details.refetch();
          },
        };
    }
  };

  const submit = () => {
    if (create.isPending) return;
    setFailure(null);
    create.mutate(
      {
        menuItemId: item.id,
        ...(params.dealId === null ? {} : { dealId: params.dealId }),
        ...(params.offerId === null ? {} : { offerId: params.offerId }),
      },
      {
        onSuccess: (booking) => {
          haptic.success();
          void navigate(`/bookings/${String(booking.id)}`, { replace: true });
        },
        onError: (error) => {
          const known = error instanceof ApiError ? CREATE_ERRORS[error.code] : undefined;
          setFailure({ text: known?.text ?? userMessage(error), actions: known?.actions ?? [] });
        },
      },
    );
  };

  return (
    <>
      <section className={styles.card} aria-label="Бронь">
        <h2 className={styles.title}>{item.name}</h2>
        <p className={styles.meta}>
          {venue.name}, {venue.address}
        </p>
        <DealPrice deal={deal} venue={venue} priceRub={item.priceRub} now={new Date()} />
        <p className={styles.meta}>{formatKcal(item.kcal)}</p>
        <DemoBadge venue={venue} />
      </section>
      <ul className={styles.terms}>
        <li>Бронь действует до 60 минут, но не дольше окончания акции и работы заведения</li>
        <li>Оплата в заведении при получении</li>
        <li>Одновременно можно держать до {MAX_ACTIVE_BOOKINGS} броней</li>
      </ul>
      {failure !== null && (
        <Notice tone="error">
          {failure.text}
          {failure.actions.length > 0 && (
            <span className={styles.actions}>
              {failure.actions.map((action) => {
                const button = act(action);
                return (
                  <Button key={action} size="medium" variant="secondary" stretched onClick={button.onClick}>
                    {button.label}
                  </Button>
                );
              })}
            </span>
          )}
        </Notice>
      )}
      <ActionBar>
        <Button size="large" stretched loading={create.isPending} onClick={submit}>
          Забронировать
        </Button>
      </ActionBar>
    </>
  );
}

export function NewBookingScreen() {
  const [search] = useSearchParams();
  const params = parseNewBooking(search);
  return (
    <Page>
      <ScreenHeader title="Бронь" back={params === null ? '/eat' : `/venues/${String(params.venueId)}`} />
      {params === null ? (
        <Unavailable text="Эта позиция больше недоступна" venueId={null} />
      ) : (
        <Confirm key={search.toString()} params={params} />
      )}
    </Page>
  );
}

function BookingQr({ booking, large }: { booking: Booking; large: boolean }) {
  const { url, query } = useBookingQr(booking.id, true);
  if (query.isError) {
    return (
      <Notice tone="error">
        Покажите код сотруднику.{' '}
        <Button
          size="small"
          variant="secondary"
          onClick={() => {
            void query.refetch();
          }}
        >
          Повторить
        </Button>
      </Notice>
    );
  }
  if (url === null) return <Skeleton height={large ? 320 : 200} />;
  return (
    <img
      src={url}
      alt={`QR-код брони ${booking.code}`}
      width={large ? 420 : 200}
      height={large ? 420 : 200}
    />
  );
}

function FullscreenQr({ booking, onClose }: { booking: Booking; onClose: () => void }) {
  const [brighter, setBrighter] = useState(false);
  const closeRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    closeRef.current?.querySelector<HTMLButtonElement>('button:last-of-type')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => {
    let active = true;
    void requestMaxBrightness().then((granted) => {
      if (active) setBrighter(granted);
    });
    const onHidden = () => {
      if (document.visibilityState === 'hidden') void restoreBrightness();
    };
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', onHidden);
      void restoreBrightness();
    };
  }, []);

  return (
    <div className={styles.fullscreen} role="dialog" aria-modal="true" aria-label="QR для сотрудника">
      <BookingQr booking={booking} large />
      <Code code={booking.code} className={styles.fullscreenCode} />
      <Countdown expiresAt={booking.expiresAt} />
      <p className={styles.meta}>Покажите QR или код сотруднику заведения</p>
      <div className={styles.fullscreenActions} ref={closeRef}>
        {brighter && (
          <Button
            size="large"
            variant="secondary"
            stretched
            onClick={() => {
              void requestMaxBrightness().then(setBrighter);
            }}
          >
            Ярче
          </Button>
        )}
        <Button size="large" stretched onClick={onClose}>
          Закрыть
        </Button>
      </div>
    </div>
  );
}

function Resolved({ booking }: { booking: Booking }) {
  const navigate = useNavigate();
  const go = (path: string) => () => {
    void navigate(path);
  };
  if (booking.status === 'redeemed') {
    return (
      <ScreenState
        status="empty"
        title="Готово! Бронь получена, блюдо записано в дневник"
        action={{ label: 'Открыть дневник', onClick: go('/diary') }}
        secondaryAction={{ label: 'Что поесть дальше', onClick: go('/eat') }}
      />
    );
  }
  return (
    <ScreenState
      status="empty"
      title={booking.status === 'expired' ? 'Время брони вышло' : 'Бронь отменена'}
      action={{ label: booking.status === 'expired' ? 'Найти другое' : 'Что поесть', onClick: go('/eat') }}
      secondaryAction={{ label: 'Мои брони', onClick: go('/bookings') }}
    />
  );
}

function ActiveBooking({ booking, refetch }: { booking: Booking; refetch: () => Promise<unknown> }) {
  const [, setParams] = useSearchParams();
  const toast = useToast();
  const cancel = useCancelBooking(booking.id);
  const [confirm, setConfirm] = useState(false);
  const expired = msLeft(booking.expiresAt, useNow()) === 0;

  useEffect(() => {
    if (expired) void refetch();
  }, [expired, refetch]);

  return (
    <>
      <div className={styles.ticket}>
        <Code code={booking.code} className={styles.code} />
        <Countdown expiresAt={booking.expiresAt} />
      </div>
      <div className={styles.qr}>
        <BookingQr booking={booking} large={false} />
      </div>
      <div className={styles.actions}>
        <Button
          size="large"
          stretched
          onClick={() => {
            setParams({ view: 'qr' }, { state: { qrInApp: true } });
          }}
        >
          Показать сотруднику
        </Button>
      </div>
      <section className={styles.card} aria-label="Блюдо">
        <h2 className={styles.title}>{booking.item.name}</h2>
        <p className={styles.meta}>
          {booking.venue.name}, {booking.venue.address}
        </p>
        <p className={styles.meta}>
          {formatPrice(booking.priceRub)}, {formatKcal(booking.kcal)}
        </p>
      </section>
      <div className={styles.actions}>
        <Button
          size="large"
          variant="secondary"
          stretched
          onClick={() => {
            openExternalLink(mapsLink(booking.venue.location));
          }}
        >
          Как добраться
        </Button>
        <Button
          size="large"
          variant="secondary"
          stretched
          onClick={() => {
            setConfirm(true);
          }}
        >
          Отменить бронь
        </Button>
      </div>
      <ConfirmSheet
        open={confirm}
        title="Отменить бронь?"
        description="Порция вернётся в продажу."
        confirmLabel="Отменить бронь"
        cancelLabel="Оставить"
        destructive
        onCancel={() => {
          setConfirm(false);
        }}
        onConfirm={async () => {
          try {
            await cancel.mutateAsync();
            toast.show('Бронь отменена');
          } catch (error) {
            if (!isApiError(error, 'booking_not_active') && !isApiError(error, 'booking_expired')) {
              toast.show(userMessage(error), { tone: 'error' });
            }
          }
          setConfirm(false);
        }}
      />
    </>
  );
}

export function BookingScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const bookingId = Number(id);
  const valid = Number.isSafeInteger(bookingId) && bookingId > 0;
  const booking = useBooking(bookingId);
  const data = booking.data;
  const refetch = booking.refetch;
  const wantsQr = params.get('view') === 'qr';
  const fullscreen = wantsQr && data?.status === 'active';
  const status = data?.status;
  const previous = useRef(status);

  useEffect(() => {
    if (previous.current === 'active' && status === 'redeemed') haptic.success();
    previous.current = status;
  }, [status]);

  useEffect(() => {
    if (wantsQr && status !== undefined && status !== 'active') setParams({}, { replace: true });
  }, [wantsQr, status, setParams]);

  const closeQr = () => {
    if ((location.state as { qrInApp?: boolean } | null)?.qrInApp === true) void navigate(-1);
    else setParams({}, { replace: true });
  };
  const notFound = !valid || (data === undefined && isApiError(booking.error, 'booking_not_found'));

  return (
    <Page>
      <ScreenHeader
        title={data === undefined ? 'Бронь' : data.status === 'active' ? 'Ваша бронь' : 'Бронь'}
        back={fullscreen ? closeQr : '/bookings'}
      />
      {valid && booking.isPending && <Skeleton height={96} count={3} />}
      {(notFound || (booking.isError && data === undefined)) &&
        (notFound ? (
          <ScreenState
            status="empty"
            title="Бронь не найдена"
            action={{
              label: 'Мои брони',
              onClick: () => {
                void navigate('/bookings');
              },
            }}
          />
        ) : (
          <ScreenState
            status="error"
            title="Не удалось загрузить бронь"
            description={userMessage(booking.error)}
            action={{
              label: 'Повторить',
              onClick: () => {
                void refetch();
              },
            }}
          />
        ))}
      {data?.status === 'active' && <ActiveBooking booking={data} refetch={refetch} />}
      {data !== undefined && data.status !== 'active' && <Resolved booking={data} />}
      {fullscreen && <FullscreenQr booking={data} onClose={closeQr} />}
    </Page>
  );
}

function BookingRow({ booking }: { booking: Booking }) {
  const navigate = useNavigate();
  return (
    <li>
      <button
        type="button"
        className={styles.row}
        onClick={() => {
          void navigate(`/bookings/${String(booking.id)}`);
        }}
      >
        {booking.status === 'active' ? (
          <span className={styles.rowHead}>
            <span className={styles.rowCode} aria-label={`Код ${spelledCode(booking.code)}`}>
              {formatCode(booking.code)}
            </span>
            <Countdown expiresAt={booking.expiresAt} />
          </span>
        ) : (
          <span className={styles.rowHead}>
            <span className={styles.meta}>
              {new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(
                new Date(booking.createdAt),
              )}
            </span>
            <Label tone={booking.status === 'redeemed' ? 'violet' : 'blue'}>
              {HISTORY_LABELS[booking.status]}
            </Label>
          </span>
        )}
        <span className={styles.title}>{booking.item.name}</span>
        <span className={styles.meta}>
          {booking.venue.name}
          {booking.status !== 'active' && `, ${formatPrice(booking.priceRub)}`}
        </span>
      </button>
    </li>
  );
}

type Tab = 'active' | 'history';

export function BookingsScreen() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('active');
  const list = useBookings(tab);
  const items = list.data ?? [];
  return (
    <Page>
      <ScreenHeader title="Брони" />
      <SegmentedControl
        label="Брони"
        options={[
          { value: 'active', label: 'Активные' },
          { value: 'history', label: 'История' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'active' && (
        <p className={styles.muted}>Можно держать до {MAX_ACTIVE_BOOKINGS} активных броней.</p>
      )}
      {list.isPending && <Skeleton height={88} count={3} />}
      {list.isError && list.data === undefined && (
        <ScreenState
          status="error"
          title="Не удалось загрузить брони"
          description={userMessage(list.error)}
          action={{
            label: 'Повторить',
            onClick: () => {
              void list.refetch();
            },
          }}
        />
      )}
      {list.data !== undefined && items.length === 0 && (
        <ScreenState
          status="empty"
          title={tab === 'active' ? 'Активных броней нет' : 'Здесь появятся полученные и отменённые брони'}
          action={{
            label: 'Что поесть',
            onClick: () => {
              void navigate('/eat');
            },
          }}
        />
      )}
      {items.length > 0 && (
        <ul className={styles.list}>
          {items.map((booking) => (
            <BookingRow key={booking.id} booking={booking} />
          ))}
        </ul>
      )}
    </Page>
  );
}
