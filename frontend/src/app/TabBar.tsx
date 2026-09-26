import { Counter } from '@maxhub/max-ui';
import { Link, useLocation } from 'react-router';
import { useBookings } from '../features/bookings/queries.ts';
import { PixelIcon, type PixelIconName } from '../shared/ui/PixelIcon.tsx';
import { cx } from '../shared/ui/cx.ts';
import styles from './TabBar.module.css';

interface Tab {
  to: string;
  label: string;
  ariaLabel?: string;
  icon: PixelIconName;
  sections: readonly string[];
}

const TABS: readonly Tab[] = [
  { to: '/diary', label: 'Дневник', icon: 'diary', sections: ['/diary', '/insights'] },
  { to: '/eat', label: 'Что поесть', icon: 'eat', sections: ['/eat', '/deals', '/venues'] },
  { to: '/bookings', label: 'Брони', icon: 'bookings', sections: ['/bookings'] },
  { to: '/venue', label: 'Заведение', ariaLabel: 'Моё заведение', icon: 'venue', sections: ['/venue'] },
  { to: '/profile', label: 'Профиль', icon: 'profile', sections: ['/profile'] },
];

function isTabActive(tab: Pick<Tab, 'sections'>, pathname: string): boolean {
  return tab.sections.some((section) => pathname === section || pathname.startsWith(`${section}/`));
}

export function TabBar() {
  const { pathname } = useLocation();
  const active = useBookings('active').data?.length ?? 0;
  return (
    <nav className={styles.bar} aria-label="Разделы" data-tabbar="">
      <div className={styles.inner}>
        {TABS.map((tab) => {
          const current = isTabActive(tab, pathname);
          const count = tab.to === '/bookings' ? active : 0;
          return (
            <Link
              key={tab.to}
              to={tab.to}
              aria-label={count > 0 ? `${tab.label}, активных: ${String(count)}` : tab.ariaLabel}
              aria-current={current ? 'page' : undefined}
              className={cx(styles.tab, current && styles.active)}
            >
              <span className={styles.icon}>
                <PixelIcon name={tab.icon} size={22} />
                {count > 0 && (
                  <span className={styles.counter}>
                    <Counter value={count} variant="attention" />
                  </span>
                )}
              </span>
              <span className={styles.label}>{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
