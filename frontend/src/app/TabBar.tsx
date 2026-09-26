import { Link, useLocation } from 'react-router';
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
  return (
    <nav className={styles.bar} aria-label="Разделы" data-tabbar="">
      <div className={styles.inner}>
        {TABS.map((tab) => {
          const active = isTabActive(tab, pathname);
          return (
            <Link
              key={tab.to}
              to={tab.to}
              aria-label={tab.ariaLabel}
              aria-current={active ? 'page' : undefined}
              className={cx(styles.tab, active && styles.active)}
            >
              <PixelIcon name={tab.icon} size={22} />
              <span className={styles.label}>{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
