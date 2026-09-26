import { useNavigate } from 'react-router';
import { formatPrice } from '../../shared/format.ts';
import { Label } from '../../shared/ui/Label.tsx';
import { SegmentedControl } from '../../shared/ui/SegmentedControl.tsx';
import { dealEnds, timeLeft, type Deal, type Venue } from './model.ts';
import styles from './Eat.module.css';

const SECTIONS = [
  { value: '/eat', label: 'Подборка' },
  { value: '/deals', label: 'Горящее' },
  { value: '/venues', label: 'Заведения' },
] as const;

type Section = (typeof SECTIONS)[number]['value'];

export function EatTabs({ current }: { current: Section }) {
  const navigate = useNavigate();
  return (
    <div className={styles.tabs}>
      <SegmentedControl
        label="Раздел"
        options={SECTIONS}
        value={current}
        onChange={(value) => {
          void navigate(value);
        }}
      />
    </div>
  );
}

export function DemoBadge({ venue }: { venue: Pick<Venue, 'isDemo'> }) {
  return venue.isDemo ? <Label tone="cyan">Заведение и меню тестовые</Label> : null;
}

export function DealPrice({
  deal,
  venue,
  priceRub,
  now,
}: {
  deal: Deal | null;
  venue: Venue;
  priceRub: number;
  now: Date;
}) {
  if (deal === null) return <span className={styles.price}>{formatPrice(priceRub)}</span>;
  const left = timeLeft(deal.endsAt, now);
  return (
    <div className={styles.dealLine}>
      <span className={styles.price}>{formatPrice(deal.priceRub)}</span>
      <s className={styles.oldPrice} aria-label={`обычная цена ${formatPrice(deal.originalPriceRub)}`}>
        {formatPrice(deal.originalPriceRub)}
      </s>
      <Label tone="pink">-{deal.discountPercent}%</Label>
      <span className={styles.dealMeta}>
        {dealEnds(deal, venue)}
        {left !== null && `, ${left}`}, осталось {deal.quantityLeft} шт.
      </span>
    </div>
  );
}
