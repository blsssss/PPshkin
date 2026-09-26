import { Button } from '@maxhub/max-ui';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { formatDistance, formatKcal } from '../../shared/format.ts';
import { VENUE_CATEGORY_LABELS } from '../../shared/vocabulary.ts';
import { bookingLink, type RecommendationItem } from './model.ts';
import { DealPrice, DemoBadge } from './parts.tsx';
import styles from './Eat.module.css';

export type DeclineReason = 'not_today' | 'dislike';

function Explanation({ item, open }: { item: RecommendationItem; open: boolean }) {
  const [expanded, setExpanded] = useState(open);
  return (
    <details
      className={styles.why}
      open={expanded}
      onToggle={(event) => {
        setExpanded(event.currentTarget.open);
      }}
    >
      <summary className={styles.whySummary}>Почему это блюдо</summary>
      {item.facts.length > 0 && (
        <section>
          <h4 className={styles.whyTitle}>Факты</h4>
          <ul className={styles.whyList}>
            {item.facts.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
        </section>
      )}
      {item.calculations.length > 0 && (
        <section>
          <h4 className={styles.whyTitle}>Расчёт</h4>
          <ul className={styles.whyList}>
            {item.calculations.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      )}
      {item.assumptions.length > 0 && (
        <section className={styles.assumptions}>
          <h4 className={styles.whyTitle}>Допущения</h4>
          <ul className={styles.whyList}>
            {item.assumptions.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      )}
    </details>
  );
}

export function RecommendationCard({
  item,
  expanded,
  now,
  onDecline,
}: {
  item: RecommendationItem;
  expanded: boolean;
  now: Date;
  onDecline: (reason: DeclineReason) => void;
}) {
  const navigate = useNavigate();
  return (
    <article className={styles.card} aria-label={item.item.name}>
      <h3 className={styles.headline}>{item.headline}</h3>
      <p className={styles.dish}>{item.item.name}</p>
      <p className={styles.venueLine}>
        {item.venue.name}, {VENUE_CATEGORY_LABELS[item.venue.category].toLowerCase()}
        {item.distanceM !== null && `, ${formatDistance(item.distanceM)}`}
      </p>
      <div className={styles.cardMeta}>
        <span className={styles.kcal}>около {formatKcal(item.kcal)}</span>
        <DealPrice deal={item.deal} venue={item.venue} priceRub={item.priceRub} now={now} />
        <DemoBadge venue={item.venue} />
      </div>
      <Explanation item={item} open={expanded} />
      <div className={styles.cardActions}>
        <Button
          size="large"
          stretched
          onClick={() => {
            void navigate(
              bookingLink({
                venueId: item.venue.id,
                menuItemId: item.item.id,
                dealId: item.deal?.id,
                offerId: item.offerId,
              }),
            );
          }}
        >
          Забронировать
        </Button>
        <Button
          size="medium"
          variant="secondary"
          stretched
          onClick={() => {
            void navigate(`/venues/${item.venue.id}`);
          }}
        >
          О заведении
        </Button>
        <div className={styles.declineRow}>
          <Button
            size="medium"
            variant="ghost"
            onClick={() => {
              onDecline('not_today');
            }}
          >
            Не сегодня
          </Button>
          <Button
            size="medium"
            variant="ghost"
            onClick={() => {
              onDecline('dislike');
            }}
          >
            Не люблю такое
          </Button>
        </div>
      </div>
    </article>
  );
}
