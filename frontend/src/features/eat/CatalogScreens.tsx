import { Button, Counter, Switch } from '@maxhub/max-ui';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { userMessage } from '../../api/messages.ts';
import { buildStartAppLink } from '../../app/startParam.ts';
import { formatDistance, formatKcal } from '../../shared/format.ts';
import { Chip, ChipRow } from '../../shared/ui/Chip.tsx';
import { cx } from '../../shared/ui/cx.ts';
import { Notice } from '../../shared/ui/Notice.tsx';
import { Page } from '../../shared/ui/Page.tsx';
import { ScreenHeader } from '../../shared/ui/ScreenHeader.tsx';
import { ScreenState } from '../../shared/ui/ScreenState.tsx';
import { ShareButton } from '../../shared/ui/ShareButton.tsx';
import { Skeleton } from '../../shared/ui/Skeleton.tsx';
import { VENUE_CATEGORY_LABELS } from '../../shared/vocabulary.ts';
import {
  bookingLink,
  dealShareText,
  demoCenterUsed,
  RADIUS_OPTIONS,
  radiusLabel,
  readRadius,
  writeRadius,
  type Radius,
} from './model.ts';
import { DealPrice, DemoBadge, EatTabs } from './parts.tsx';
import { useNearbyDeals, useNearbyVenues } from './queries.ts';
import { SearchPointBar, useLocator, useSearchPoint } from './SearchPoint.tsx';
import styles from './Eat.module.css';

const HIGHLIGHT_MS = 2000;

function useRadius(): [Radius, (radius: Radius) => void] {
  const [radius, setRadius] = useState<Radius>(readRadius);
  return [
    radius,
    (next) => {
      writeRadius(next);
      setRadius(next);
    },
  ];
}

function RadiusPicker({
  radius,
  onChange,
  disabled,
}: {
  radius: Radius;
  onChange: (radius: Radius) => void;
  disabled: boolean;
}) {
  return (
    <ChipRow label="Радиус поиска">
      {RADIUS_OPTIONS.map((option) => (
        <Chip
          key={option}
          pressed={radius === option}
          disabled={disabled}
          onClick={() => {
            onChange(option);
          }}
        >
          {radiusLabel(option)}
        </Chip>
      ))}
    </ChipRow>
  );
}

export function DealsScreen() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const highlight = Number(params.get('highlight') ?? Number.NaN);
  const { source, point } = useSearchPoint();
  const locator = useLocator();
  const [radius, setRadius] = useRadius();
  const deals = useNearbyDeals(point, radius);
  const [flash, setFlash] = useState<number | null>(null);
  const scrolled = useRef(false);
  const now = new Date();
  const items = deals.data?.items ?? [];
  const found = Number.isFinite(highlight) && items.some((card) => card.deal.id === highlight);

  useEffect(() => {
    if (!found || scrolled.current) return;
    document.getElementById(`deal-${highlight}`)?.scrollIntoView({ block: 'center' });
    setFlash(highlight);
    const timer = setTimeout(() => {
      scrolled.current = true;
      setFlash(null);
    }, HIGHLIGHT_MS);
    return () => {
      clearTimeout(timer);
      setFlash(null);
    };
  }, [found, highlight]);

  return (
    <Page>
      <ScreenHeader title="Горящее рядом" />
      <EatTabs current="/deals" />
      <SearchPointBar source={source} demoCenter={demoCenterUsed(deals.data)} locator={locator} />
      <RadiusPicker radius={radius} onChange={setRadius} disabled={point === null} />
      {Number.isFinite(highlight) && deals.data !== undefined && !found && (
        <Notice>
          Эта горящая позиция уже закончилась или находится дальше выбранного радиуса.
          {point !== null && radius !== 10_000 && (
            <button
              type="button"
              className={styles.inlineLink}
              onClick={() => {
                setRadius(10_000);
              }}
            >
              Искать в радиусе 10 км
            </button>
          )}
        </Notice>
      )}
      {deals.isPending && <Skeleton height={160} count={3} />}
      {deals.isError && (
        <ScreenState
          status="error"
          title="Не удалось загрузить горящие позиции"
          description={userMessage(deals.error)}
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
          title="Рядом сейчас нет горящих позиций"
          action={
            point !== null && radius !== 10_000
              ? {
                  label: 'Увеличить радиус',
                  onClick: () => {
                    setRadius(10_000);
                  },
                }
              : {
                  label: 'Все заведения',
                  onClick: () => {
                    void navigate('/venues');
                  },
                }
          }
          secondaryAction={
            point !== null && radius !== 10_000
              ? {
                  label: 'Все заведения',
                  onClick: () => {
                    void navigate('/venues');
                  },
                }
              : undefined
          }
        />
      )}
      <div className={styles.cards}>
        {items.map(({ deal, item, venue, distanceM }) => (
          <article
            key={deal.id}
            id={`deal-${deal.id}`}
            className={cx(styles.card, flash === deal.id && styles.flash)}
            aria-label={deal.itemName}
          >
            <button
              type="button"
              className={styles.cardLink}
              onClick={() => {
                void navigate(`/venues/${venue.id}`);
              }}
            >
              <span className={styles.dish}>{deal.itemName}</span>
              <span className={styles.venueLine}>
                {venue.name}
                {distanceM !== null && `, ${formatDistance(distanceM)}`}
              </span>
            </button>
            <div className={styles.cardMeta}>
              <span className={styles.kcal}>{formatKcal(item.kcal)}</span>
              <DealPrice deal={deal} venue={venue} priceRub={deal.priceRub} now={now} />
              <DemoBadge venue={venue} />
            </div>
            <div className={styles.cardActions}>
              <Button
                size="large"
                stretched
                onClick={() => {
                  void navigate(bookingLink({ venueId: venue.id, menuItemId: item.id, dealId: deal.id }));
                }}
              >
                Забронировать
              </Button>
              <ShareButton
                size="medium"
                text={dealShareText(deal, venue)}
                link={buildStartAppLink(`venue_${venue.id}`)}
              />
            </div>
          </article>
        ))}
      </div>
    </Page>
  );
}

export function VenuesScreen() {
  const navigate = useNavigate();
  const { source, point } = useSearchPoint();
  const locator = useLocator();
  const [radius, setRadius] = useRadius();
  const [onlyOpen, setOnlyOpen] = useState(false);
  const venues = useNearbyVenues(point, radius);
  const items = (venues.data?.items ?? []).filter((card) => !onlyOpen || card.openNow);

  return (
    <Page>
      <ScreenHeader title="Заведения" />
      <EatTabs current="/venues" />
      <SearchPointBar source={source} demoCenter={demoCenterUsed(venues.data)} locator={locator} />
      <RadiusPicker radius={radius} onChange={setRadius} disabled={point === null} />
      <label className={styles.switchRow}>
        <span>Только открытые</span>
        <Switch
          checked={onlyOpen}
          onChange={(event) => {
            setOnlyOpen(event.target.checked);
          }}
        />
      </label>
      {venues.isPending && <Skeleton height={72} count={4} />}
      {venues.isError && (
        <ScreenState
          status="error"
          title="Не удалось загрузить заведения"
          description={userMessage(venues.error)}
          action={{
            label: 'Повторить',
            onClick: () => {
              void venues.refetch();
            },
          }}
        />
      )}
      {venues.data !== undefined && items.length === 0 && venues.data.items.length > 0 && (
        <ScreenState
          status="empty"
          title="Сейчас все заведения рядом закрыты"
          action={{
            label: 'Показать все',
            onClick: () => {
              setOnlyOpen(false);
            },
          }}
        />
      )}
      {venues.data?.items.length === 0 && (
        <ScreenState
          status="empty"
          title={point === null ? 'Заведений пока нет' : `В радиусе ${radiusLabel(radius)} заведений нет`}
          action={
            point !== null && radius !== 10_000
              ? {
                  label: 'Увеличить радиус',
                  onClick: () => {
                    setRadius(10_000);
                  },
                }
              : {
                  label: 'К подборке',
                  onClick: () => {
                    void navigate('/eat');
                  },
                }
          }
        />
      )}
      <ul className={styles.venueList}>
        {items.map(({ venue, distanceM, openNow, activeDeals }) => (
          <li key={venue.id}>
            <button
              type="button"
              className={styles.venueRow}
              onClick={() => {
                void navigate(`/venues/${venue.id}`);
              }}
            >
              <span className={styles.venueName}>{venue.name}</span>
              <span className={styles.venueMeta}>
                {VENUE_CATEGORY_LABELS[venue.category]}
                {distanceM !== null && `, ${formatDistance(distanceM)}`}, {openNow ? 'Открыто' : 'Закрыто'}
              </span>
              {activeDeals > 0 && (
                <span className={styles.venueDeals}>
                  <Counter value={activeDeals} variant="attention" /> горящих
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </Page>
  );
}
