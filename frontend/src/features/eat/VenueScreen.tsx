import { Button } from '@maxhub/max-ui';
import { useNavigate, useParams } from 'react-router';
import { isApiError } from '../../api/errors.ts';
import { userMessage } from '../../api/messages.ts';
import { buildStartAppLink } from '../../app/startParam.ts';
import { openExternalLink } from '../../max/bridge.ts';
import { formatDistance, formatKcal, formatPrice } from '../../shared/format.ts';
import { distanceMeters, useDevicePoint } from '../../shared/geo/devicePoint.ts';
import { Label } from '../../shared/ui/Label.tsx';
import { Page } from '../../shared/ui/Page.tsx';
import { ScreenHeader } from '../../shared/ui/ScreenHeader.tsx';
import { ScreenState } from '../../shared/ui/ScreenState.tsx';
import { ShareButton } from '../../shared/ui/ShareButton.tsx';
import { Skeleton } from '../../shared/ui/Skeleton.tsx';
import {
  MENU_CATEGORY_LABELS,
  TAG_LABELS,
  VENUE_CATEGORY_LABELS,
  type MenuCategory,
} from '../../shared/vocabulary.ts';
import { bookingLink, hoursText, mapsLink, venueShareText, type MenuItem } from './model.ts';
import { DealPrice, DemoBadge } from './parts.tsx';
import { useVenueDetails } from './queries.ts';
import styles from './Eat.module.css';

const CATEGORY_ORDER = Object.keys(MENU_CATEGORY_LABELS) as MenuCategory[];

function nutrition(item: MenuItem): string {
  const parts = [formatKcal(item.kcal), item.nutritionSource === 'venue' ? 'по данным заведения' : 'оценка'];
  if (item.proteinG !== null && item.fatG !== null && item.carbsG !== null) {
    parts.push(`Б ${item.proteinG} г, Ж ${item.fatG} г, У ${item.carbsG} г`.replace(/\./g, ','));
  }
  return parts.join(', ');
}

export function VenueScreen() {
  const navigate = useNavigate();
  const { id } = useParams();
  const venueId = Number(id);
  const valid = Number.isInteger(venueId) && venueId > 0;
  const details = useVenueDetails(valid ? venueId : 0);
  const device = useDevicePoint();
  const now = new Date();

  const notFound = !valid || (details.isError && isApiError(details.error, 'venue_not_found'));
  if (notFound) {
    return (
      <Page>
        <ScreenHeader title="Заведение" back="/eat" />
        <ScreenState
          status="empty"
          title="Заведение не найдено"
          action={{
            label: 'К подборке',
            onClick: () => {
              void navigate('/eat');
            },
          }}
        />
      </Page>
    );
  }

  const data = details.data;
  return (
    <Page>
      <ScreenHeader title={data?.venue.name ?? 'Заведение'} back="/eat" />
      {details.isPending && <Skeleton height={120} count={3} />}
      {details.isError && (
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
      )}
      {data !== undefined && (
        <>
          <section className={styles.venueHead}>
            <p className={styles.venueMeta}>
              {VENUE_CATEGORY_LABELS[data.venue.category]}, {data.venue.address}
            </p>
            <p className={styles.hours}>
              <Label tone={data.openNow ? 'violet' : 'pink'}>{hoursText(data.venue, data.openNow)}</Label>
              {device !== null && (
                <span className={styles.venueMeta}>
                  {formatDistance(distanceMeters(device, data.venue.location))}
                </span>
              )}
            </p>
            <DemoBadge venue={data.venue} />
            <div className={styles.headActions}>
              <Button
                size="medium"
                variant="secondary"
                stretched
                onClick={() => {
                  openExternalLink(mapsLink(data.venue.location));
                }}
              >
                Как добраться
              </Button>
              <ShareButton
                size="medium"
                text={venueShareText(data.venue)}
                link={buildStartAppLink(`venue_${data.venue.id}`)}
              />
            </div>
          </section>

          {!data.openNow && <p className={styles.muted}>Бронь доступна, когда заведение открыто.</p>}

          {data.deals.length > 0 && (
            <section aria-label="Горящее">
              <h2 className={styles.sectionTitle}>Горящее</h2>
              <div className={styles.cards}>
                {data.deals.map((deal) => (
                  <article key={deal.id} className={styles.card} aria-label={deal.itemName}>
                    <p className={styles.dish}>{deal.itemName}</p>
                    <DealPrice deal={deal} venue={data.venue} priceRub={deal.priceRub} now={now} />
                    <Button
                      size="large"
                      stretched
                      disabled={!data.openNow}
                      onClick={() => {
                        void navigate(
                          bookingLink({
                            venueId: data.venue.id,
                            menuItemId: deal.menuItemId,
                            dealId: deal.id,
                          }),
                        );
                      }}
                    >
                      Забронировать
                    </Button>
                  </article>
                ))}
              </div>
            </section>
          )}

          {CATEGORY_ORDER.map((category) => {
            const items = data.menu.filter((item) => item.category === category && item.isAvailable);
            if (items.length === 0) return null;
            return (
              <section key={category} aria-label={MENU_CATEGORY_LABELS[category]}>
                <h2 className={styles.sectionTitle}>{MENU_CATEGORY_LABELS[category]}</h2>
                <ul className={styles.menu}>
                  {items.map((item) => (
                    <li key={item.id} className={styles.menuItem}>
                      <div className={styles.menuHead}>
                        <span className={styles.menuName}>{item.name}</span>
                        <span className={styles.price}>{formatPrice(item.priceRub)}</span>
                      </div>
                      <p className={styles.menuMeta}>
                        {item.weightG !== null && `${item.weightG} г, `}
                        {nutrition(item)}
                      </p>
                      {item.tags.length > 0 && (
                        <p className={styles.menuTags}>
                          {item.tags.map((tag) => TAG_LABELS[tag]).join(', ')}
                        </p>
                      )}
                      <Button
                        size="small"
                        variant="secondary"
                        disabled={!data.openNow}
                        onClick={() => {
                          void navigate(bookingLink({ venueId: data.venue.id, menuItemId: item.id }));
                        }}
                      >
                        Забронировать
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </>
      )}
    </Page>
  );
}
