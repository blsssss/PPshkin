import { Button } from '@maxhub/max-ui';
import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { isApiError } from '../../api/errors.ts';
import { userMessage } from '../../api/messages.ts';
import { buildStartAppLink } from '../../app/startParam.ts';
import { haptic } from '../../max/bridge.ts';
import { formatPrice } from '../../shared/format.ts';
import { isOpenNow } from '../../shared/openNow.ts';
import { useOnline } from '../../shared/useOnline.ts';
import { useUnsavedChanges } from '../../shared/useUnsavedChanges.tsx';
import { ActionBar } from '../../shared/ui/ActionBar.tsx';
import { Chip, ChipRow } from '../../shared/ui/Chip.tsx';
import { ConfirmSheet } from '../../shared/ui/ConfirmSheet.tsx';
import { Field } from '../../shared/ui/Field.tsx';
import { Label } from '../../shared/ui/Label.tsx';
import { Notice } from '../../shared/ui/Notice.tsx';
import { Page } from '../../shared/ui/Page.tsx';
import { ScreenHeader } from '../../shared/ui/ScreenHeader.tsx';
import { ScreenState } from '../../shared/ui/ScreenState.tsx';
import { SegmentedControl } from '../../shared/ui/SegmentedControl.tsx';
import { ShareButton } from '../../shared/ui/ShareButton.tsx';
import { Skeleton } from '../../shared/ui/Skeleton.tsx';
import { useToast } from '../../shared/ui/Toast.tsx';
import {
  DEAL_STATUS_LABELS,
  dealPreview,
  dealPriceLine,
  discountedPrice,
  DISCOUNTS,
  MAX_QUANTITY,
  QUANTITIES,
  resolveEnd,
  validDealPrice,
  venueClock,
  withinWindow,
  type Deal,
  type EndChoice,
} from './dealModel.ts';
import { useCancelDeal, useCreateDeal, useUpdateDeal, useVenueDeals } from './dealQueries.ts';
import { normalizeName, type MenuItem, type Venue } from './model.ts';
import { useVenue, useVenueMenu, useVenueNotFoundRedirect } from './queries.ts';
import styles from './Venue.module.css';
import { useLeave } from '../../shared/appHistory.ts';

const FORM_ERRORS: Record<string, string> = {
  deal_price_not_lower: 'Цена со скидкой должна быть ниже обычной цены',
  menu_item_unavailable: 'Позиция скрыта из продажи. Включите её в меню',
  menu_item_not_found: 'Не нашли позицию или предложение, обновите список',
  deal_not_found: 'Не нашли позицию или предложение, обновите список',
};

function dealError(error: unknown): string {
  return isApiError(error) ? (FORM_ERRORS[error.code] ?? userMessage(error)) : userMessage(error);
}

function DealCard({ deal, venue, finished }: { deal: Deal; venue: Venue; finished: boolean }) {
  const navigate = useNavigate();
  const toast = useToast();
  const cancel = useCancelDeal();
  const [confirm, setConfirm] = useState(false);
  return (
    <li className={styles.reviewRow}>
      <div className={styles.reviewHead}>
        <div className={styles.reviewSummary}>
          <span className={styles.itemName}>{deal.itemName}</span>
          <span className={styles.meta}>{dealPriceLine(deal)}</span>
          <span className={styles.meta}>
            Осталось {deal.quantityLeft} из {deal.quantityTotal}, до {venueClock(deal.endsAt, venue.timezone)}
          </span>
        </div>
        <Label tone={deal.status === 'active' ? 'violet' : deal.status === 'scheduled' ? 'blue' : 'pink'}>
          {DEAL_STATUS_LABELS[deal.status]}
        </Label>
      </div>
      <div className={styles.row}>
        {finished ? (
          <Button
            size="medium"
            variant="secondary"
            stretched
            aria-label={`Повторить: ${deal.itemName}`}
            onClick={() => {
              void navigate(
                `/venue/deals/new?itemId=${String(deal.menuItemId)}&priceRub=${String(deal.priceRub)}&quantity=${String(deal.quantityTotal)}`,
              );
            }}
          >
            Повторить
          </Button>
        ) : (
          <>
            <Button
              size="medium"
              variant="secondary"
              stretched
              aria-label={`Изменить: ${deal.itemName}`}
              onClick={() => {
                void navigate(`/venue/deals/${String(deal.id)}`);
              }}
            >
              Изменить
            </Button>
            <Button
              size="medium"
              variant="secondary"
              stretched
              aria-label={`Снять с продажи: ${deal.itemName}`}
              onClick={() => {
                setConfirm(true);
              }}
            >
              Снять с продажи
            </Button>
          </>
        )}
      </div>
      <ConfirmSheet
        open={confirm}
        title={`Снять «${deal.itemName}» с продажи?`}
        description="Уже оформленные брони останутся в силе."
        confirmLabel="Снять"
        destructive
        onCancel={() => {
          setConfirm(false);
        }}
        onConfirm={async () => {
          try {
            await cancel.mutateAsync(deal.id);
            toast.show('Горящая позиция снята');
          } catch (error) {
            haptic.error();
            toast.show(dealError(error), { tone: 'error' });
          }
          setConfirm(false);
        }}
      />
    </li>
  );
}

export function VenueDealsScreen() {
  const navigate = useNavigate();
  const venue = useVenue();
  useVenueNotFoundRedirect();
  const [tab, setTab] = useState<'active' | 'finished'>('active');
  const deals = useVenueDeals(tab);
  const items = deals.data ?? [];
  const data = venue.data;
  return (
    <Page>
      <ScreenHeader title="Горящие позиции" back="/venue" />
      <div className={styles.group}>
        <SegmentedControl
          label="Горящие позиции"
          options={[
            { value: 'active', label: 'Активные' },
            { value: 'finished', label: 'Завершённые' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>
      {tab === 'active' && items.length > 0 && (
        <div className={styles.actions}>
          <Button
            size="medium"
            stretched
            onClick={() => {
              void navigate('/venue/deals/new');
            }}
          >
            Добавить
          </Button>
        </div>
      )}
      {(deals.isPending || venue.isPending) && <Skeleton height={96} count={3} />}
      {deals.isError && (
        <ScreenState
          status="error"
          title="Не удалось загрузить горящие позиции"
          description={userMessage(deals.error)}
          error={deals.error}
          action={{
            label: 'Повторить',
            onClick: () => {
              void deals.refetch();
            },
          }}
        />
      )}
      {deals.data !== undefined && items.length === 0 && (
        <ScreenState
          status="empty"
          title={
            tab === 'active'
              ? 'Нет горящих позиций. Отметьте то, что осталось к вечеру, со скидкой: гости рядом увидят это в рекомендациях'
              : 'За последние 7 дней завершённых нет'
          }
          action={{
            label: 'Добавить',
            onClick: () => {
              void navigate('/venue/deals/new');
            },
          }}
        />
      )}
      {items.length > 0 && data !== undefined && data !== null && (
        <ul className={styles.review}>
          {items.map((deal) => (
            <DealCard key={deal.id} deal={deal} venue={data} finished={tab === 'finished'} />
          ))}
        </ul>
      )}
    </Page>
  );
}

type Price = { kind: 'discount'; percent: number } | { kind: 'custom'; value: string };
type Quantity = { kind: 'preset'; value: number } | { kind: 'custom'; value: string };

function priceOf(price: Price, item: MenuItem | undefined): number | null {
  if (item === undefined) return null;
  if (price.kind === 'discount') return discountedPrice(item.priceRub, price.percent);
  const value = Number(price.value.trim());
  return price.value.trim().length > 0 && Number.isInteger(value) ? value : null;
}

function quantityOf(quantity: Quantity): number | null {
  if (quantity.kind === 'preset') return quantity.value;
  const value = Number(quantity.value.trim());
  return Number.isInteger(value) && value >= 1 && value <= MAX_QUANTITY ? value : null;
}

function EndChoices({
  venue,
  value,
  onChange,
}: {
  venue: Venue;
  value: EndChoice | { kind: 'none' };
  onChange: (value: EndChoice) => void;
}) {
  const roundTheClock = venue.opensAt === venue.closesAt;
  return (
    <>
      <ChipRow label="До какого времени">
        <Chip
          pressed={value.kind === 'hours' && value.hours === 1}
          onClick={() => {
            onChange({ kind: 'hours', hours: 1 });
          }}
        >
          1 час
        </Chip>
        <Chip
          pressed={value.kind === 'hours' && value.hours === 2}
          onClick={() => {
            onChange({ kind: 'hours', hours: 2 });
          }}
        >
          2 часа
        </Chip>
        {!roundTheClock && (
          <Chip
            pressed={value.kind === 'closing'}
            onClick={() => {
              onChange({ kind: 'closing' });
            }}
          >
            До закрытия
          </Chip>
        )}
        <Chip
          pressed={value.kind === 'time'}
          onClick={() => {
            onChange({ kind: 'time', time: value.kind === 'time' ? value.time : venue.closesAt });
          }}
        >
          Другое время
        </Chip>
      </ChipRow>
      {value.kind === 'time' && (
        <Field
          label="Время окончания"
          type="time"
          value={value.time}
          onChange={(event) => {
            onChange({ kind: 'time', time: event.target.value });
          }}
        />
      )}
    </>
  );
}

function initialPrice(params: URLSearchParams): Price {
  const value = params.get('priceRub');
  return value === null ? { kind: 'discount', percent: 30 } : { kind: 'custom', value };
}

function initialQuantity(params: URLSearchParams): Quantity {
  const value = Number(params.get('quantity'));
  if (!Number.isInteger(value) || value < 1) return { kind: 'preset', value: 5 };
  return (QUANTITIES as readonly number[]).includes(value)
    ? { kind: 'preset', value }
    : { kind: 'custom', value: String(value) };
}

function DealForm({ venue, menu, active }: { venue: Venue; menu: MenuItem[]; active: Deal[] }) {
  const navigate = useNavigate();
  const leave = useLeave();
  const online = useOnline();
  const [params] = useSearchParams();
  const create = useCreateDeal();
  const [itemId, setItemId] = useState<number | null>(() => {
    const value = Number(params.get('itemId'));
    return Number.isInteger(value) && value > 0 ? value : null;
  });
  const [search, setSearch] = useState('');
  const [quantity, setQuantity] = useState<Quantity>(() => initialQuantity(params));
  const [price, setPrice] = useState<Price>(() => initialPrice(params));
  const [end, setEnd] = useState<EndChoice>({ kind: 'hours', hours: 2 });
  const [error, setError] = useState<{ text: string; open: boolean } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [published, setPublished] = useState<Deal | null>(null);
  const [initial] = useState(() => JSON.stringify({ itemId, quantity, price, end }));
  const changed = JSON.stringify({ itemId, quantity, price, end }) !== initial;
  const { prompt, release } = useUnsavedChanges(published === null && changed);

  const available = menu.filter((entry) => entry.isAvailable);
  const busy = new Set(active.map((deal) => deal.menuItemId));
  const item = available.find((entry) => entry.id === itemId);
  const now = new Date();
  const amount = priceOf(price, item);
  const count = quantityOf(quantity);
  const endsAt = resolveEnd(end, venue, now);
  const priceValid = item !== undefined && amount !== null && validDealPrice(amount, item.priceRub);
  const endValid = endsAt !== null && withinWindow(endsAt, now);
  const ready = item !== undefined && !busy.has(item.id) && priceValid && count !== null && endValid;
  const shown =
    search.trim().length === 0
      ? available
      : available.filter((entry) => normalizeName(entry.name).includes(normalizeName(search)));

  if (published !== null) {
    return (
      <section className={styles.head} aria-label="Опубликовано">
        <h2 className={styles.sectionTitle}>Горящая позиция опубликована</h2>
        <p className={styles.counter}>
          {dealPreview(
            published.itemName,
            published.priceRub,
            published.originalPriceRub,
            published.quantityTotal,
            new Date(published.endsAt),
            venue.timezone,
          )}
        </p>
        <p className={styles.muted}>Гости рядом увидят её в подборке и в горящих позициях.</p>
        <div className={styles.actions}>
          <ShareButton
            text={`${published.itemName} за ${formatPrice(published.priceRub)} до ${venueClock(published.endsAt, venue.timezone)} в «${venue.name}»`}
            link={buildStartAppLink(`venue_${String(venue.id)}`)}
          />
          <Button
            size="large"
            stretched
            onClick={() => {
              leave('/venue/deals');
            }}
          >
            К списку
          </Button>
        </div>
      </section>
    );
  }

  const publish = () => {
    if (!ready) return;
    setError(null);
    setFieldErrors({});
    create.mutate(
      { menuItemId: item.id, priceRub: amount, quantity: count, endsAt: endsAt.toISOString() },
      {
        onSuccess: (deal) => {
          release();
          haptic.success();
          setPublished(deal);
        },
        onError: (failure) => {
          haptic.error();
          if (isApiError(failure, 'validation_failed') && Object.keys(failure.fieldErrors).length > 0) {
            setFieldErrors(failure.fieldErrors);
            return;
          }
          setError({ text: dealError(failure), open: isApiError(failure, 'deal_exists') });
        },
      },
    );
  };

  return (
    <>
      {!isOpenNow(venue.opensAt, venue.closesAt, venue.timezone, now) && (
        <Notice>Заведение сейчас закрыто: гости не смогут забронировать до открытия</Notice>
      )}
      <h2 className={styles.sectionTitle}>Позиция</h2>
      {available.length > 8 && (
        <Field
          label="Поиск по меню"
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
        />
      )}
      {available.length === 0 && <p className={styles.muted}>В меню нет позиций в продаже.</p>}
      <ChipRow label="Позиция">
        {shown.map((entry) => (
          <Chip
            key={entry.id}
            pressed={entry.id === itemId}
            disabled={busy.has(entry.id)}
            onClick={() => {
              setItemId(entry.id);
            }}
          >
            {entry.name}, {formatPrice(entry.priceRub)}
            {busy.has(entry.id) && ' (уже продаётся)'}
          </Chip>
        ))}
      </ChipRow>
      <h2 className={styles.sectionTitle}>Количество</h2>
      <ChipRow label="Количество">
        {QUANTITIES.map((value) => (
          <Chip
            key={value}
            pressed={quantity.kind === 'preset' && quantity.value === value}
            onClick={() => {
              setQuantity({ kind: 'preset', value });
            }}
          >
            {value} шт.
          </Chip>
        ))}
        <Chip
          pressed={quantity.kind === 'custom'}
          onClick={() => {
            setQuantity({ kind: 'custom', value: quantity.kind === 'custom' ? quantity.value : '' });
          }}
        >
          Другое
        </Chip>
      </ChipRow>
      {quantity.kind === 'custom' && (
        <Field
          label="Количество, шт."
          inputMode="numeric"
          value={quantity.value}
          onChange={(event) => {
            setQuantity({ kind: 'custom', value: event.target.value });
          }}
          error={quantity.value.length > 0 && count === null ? `От 1 до ${String(MAX_QUANTITY)}` : undefined}
        />
      )}
      {fieldErrors.quantity !== undefined && <p className={styles.error}>{fieldErrors.quantity}</p>}
      <h2 className={styles.sectionTitle}>Цена</h2>
      <ChipRow label="Цена">
        {DISCOUNTS.map((percent) => {
          const value = item === undefined ? null : discountedPrice(item.priceRub, percent);
          return (
            <Chip
              key={percent}
              pressed={price.kind === 'discount' && price.percent === percent}
              disabled={item !== undefined && value !== null && !validDealPrice(value, item.priceRub)}
              onClick={() => {
                setPrice({ kind: 'discount', percent });
              }}
            >
              -{percent}%{value !== null && `, ${formatPrice(value)}`}
            </Chip>
          );
        })}
        <Chip
          pressed={price.kind === 'custom'}
          onClick={() => {
            setPrice({ kind: 'custom', value: price.kind === 'custom' ? price.value : '' });
          }}
        >
          Своя цена
        </Chip>
      </ChipRow>
      {price.kind === 'custom' && (
        <Field
          label="Цена со скидкой, ₽"
          inputMode="numeric"
          value={price.value}
          onChange={(event) => {
            setPrice({ kind: 'custom', value: event.target.value });
          }}
          error={
            item !== undefined && price.value.length > 0 && !priceValid
              ? `От 1 до ${String(item.priceRub - 1)} ₽`
              : undefined
          }
        />
      )}
      {fieldErrors.priceRub !== undefined && <p className={styles.error}>{fieldErrors.priceRub}</p>}
      <h2 className={styles.sectionTitle}>До какого времени</h2>
      <EndChoices venue={venue} value={end} onChange={setEnd} />
      {fieldErrors.endsAt !== undefined && <p className={styles.error}>{fieldErrors.endsAt}</p>}
      {endsAt !== null && !endValid && (
        <p className={styles.error}>Время окончания должно быть в ближайшие 24 часа</p>
      )}
      {ready && (
        <p className={styles.counter}>
          {dealPreview(item.name, amount, item.priceRub, count, endsAt, venue.timezone)}
        </p>
      )}
      {error !== null && (
        <Notice tone="error">
          {error.text}
          {error.open && (
            <>
              {' '}
              <button
                type="button"
                className={styles.inlineButton}
                onClick={() => {
                  release();
                  void navigate('/venue/deals');
                }}
              >
                Открыть
              </button>
            </>
          )}
        </Notice>
      )}
      <ActionBar sends>
        <Button
          size="large"
          stretched
          loading={create.isPending}
          disabled={!ready || !online}
          onClick={publish}
        >
          Опубликовать
        </Button>
      </ActionBar>
      {prompt}
    </>
  );
}

export function NewDealScreen() {
  const venue = useVenue();
  const menu = useVenueMenu();
  const active = useVenueDeals('active');
  useVenueNotFoundRedirect();
  const data = venue.data;
  const failed = venue.error ?? menu.error ?? active.error;
  return (
    <Page>
      <ScreenHeader title="Новая горящая позиция" back="/venue/deals" />
      {(venue.isPending || menu.isPending || active.isPending) && failed === null && (
        <Skeleton height={48} count={6} />
      )}
      {failed !== null && (
        <ScreenState
          status="error"
          title="Не удалось загрузить данные"
          description={userMessage(failed)}
          error={failed}
          action={{
            label: 'Повторить',
            onClick: () => {
              void venue.refetch();
              void menu.refetch();
              void active.refetch();
            },
          }}
        />
      )}
      {data !== undefined && data !== null && menu.data !== undefined && active.data !== undefined && (
        <DealForm venue={data} menu={menu.data} active={active.data} />
      )}
    </Page>
  );
}

function EditDeal({ deal, venue }: { deal: Deal; venue: Venue }) {
  const leave = useLeave();
  const toast = useToast();
  const online = useOnline();
  const update = useUpdateDeal();
  const [left, setLeft] = useState<string | null>(null);
  const [end, setEnd] = useState<EndChoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const now = new Date();
  const shown = left ?? String(deal.quantityLeft);
  const quantity = Number(shown.trim());
  const numeric = shown.trim().length > 0 && /^\d+$/.test(shown.trim());
  const quantityValid = numeric && quantity <= deal.quantityTotal;
  const endsAt = end === null ? null : resolveEnd(end, venue, now);
  const endValid = end === null || (endsAt !== null && withinWindow(endsAt, now));
  const patch = {
    ...(left !== null && quantityValid && quantity !== deal.quantityLeft ? { quantityLeft: quantity } : {}),
    ...(endsAt !== null && endValid ? { endsAt: endsAt.toISOString() } : {}),
  };
  const { prompt, release } = useUnsavedChanges(left !== null || end !== null);

  const save = () => {
    if (!quantityValid || !endValid || Object.keys(patch).length === 0) return;
    setError(null);
    setFieldErrors({});
    update.mutate(
      { id: deal.id, patch },
      {
        onSuccess: () => {
          release();
          toast.show('Сохранено');
          leave('/venue/deals');
        },
        onError: (failure) => {
          haptic.error();
          if (isApiError(failure, 'validation_failed') && Object.keys(failure.fieldErrors).length > 0) {
            setFieldErrors(failure.fieldErrors);
            return;
          }
          setError(dealError(failure));
        },
      },
    );
  };

  return (
    <>
      <section className={styles.head} aria-label="Горящая позиция">
        <p className={styles.itemName}>{deal.itemName}</p>
        <p className={styles.meta}>{dealPriceLine(deal)}</p>
        <p className={styles.meta}>
          Сейчас до {venueClock(deal.endsAt, venue.timezone)}, осталось {deal.quantityLeft} из{' '}
          {deal.quantityTotal}
        </p>
      </section>
      <p className={styles.muted}>Чтобы изменить цену, снимите предложение и создайте новое.</p>
      <Field
        label="Осталось, шт."
        inputMode="numeric"
        value={shown}
        onChange={(event) => {
          setLeft(event.target.value);
          setFieldErrors({});
        }}
        hint={`От 0 до ${String(deal.quantityTotal)}`}
        error={
          !numeric
            ? `Введите целое число от 0 до ${String(deal.quantityTotal)}`
            : !quantityValid
              ? 'Остаток не может быть больше исходного количества'
              : fieldErrors.quantityLeft
        }
      />
      <h2 className={styles.sectionTitle}>Новое время окончания</h2>
      <EndChoices venue={venue} value={end ?? { kind: 'none' }} onChange={setEnd} />
      {!endValid && <p className={styles.error}>Время окончания должно быть в ближайшие 24 часа</p>}
      {fieldErrors.endsAt !== undefined && <p className={styles.error}>{fieldErrors.endsAt}</p>}
      {error !== null && <Notice tone="error">{error}</Notice>}
      <ActionBar sends>
        <Button
          size="large"
          stretched
          loading={update.isPending}
          disabled={!online || !quantityValid || !endValid || Object.keys(patch).length === 0}
          onClick={save}
        >
          Сохранить
        </Button>
      </ActionBar>
      {prompt}
    </>
  );
}

export function EditDealScreen() {
  const navigate = useNavigate();
  const { dealId } = useParams();
  const venue = useVenue();
  const active = useVenueDeals('active');
  useVenueNotFoundRedirect();
  const deal = active.data?.find((entry) => String(entry.id) === dealId);
  const data = venue.data;
  return (
    <Page>
      <ScreenHeader title="Горящая позиция" back="/venue/deals" />
      {(active.isPending || venue.isPending) && <Skeleton height={48} count={4} />}
      {active.isError && (
        <ScreenState
          status="error"
          title="Не удалось загрузить горящие позиции"
          description={userMessage(active.error)}
          error={active.error}
          action={{
            label: 'Повторить',
            onClick: () => {
              void active.refetch();
            },
          }}
        />
      )}
      {active.data !== undefined && deal === undefined && (
        <ScreenState
          status="empty"
          title="Предложение уже завершено или снято, изменить его нельзя"
          action={{
            label: 'К списку',
            onClick: () => {
              void navigate('/venue/deals');
            },
          }}
        />
      )}
      {deal !== undefined && data !== undefined && data !== null && <EditDeal deal={deal} venue={data} />}
    </Page>
  );
}
