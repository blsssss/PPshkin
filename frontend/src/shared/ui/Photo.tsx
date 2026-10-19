import { useState } from 'react';
import { env } from '../../env.ts';
import { cx } from './cx.ts';
import styles from './Photo.module.css';

export function photoSrc(url: string, size: 'card' | 'large' = 'card'): string {
  const base = env.apiBaseUrl.replace(/\/+$/, '');
  return `${base}${url}${size === 'large' ? '?size=large' : ''}`;
}

export function Photo({
  url,
  alt,
  size = 'card',
  shape = 'card',
  className,
}: {
  url: string | null | undefined;
  alt: string;
  size?: 'card' | 'large';
  shape?: 'card' | 'wide' | 'thumb';
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  if (url === null || url === undefined || failed === url) return null;
  return (
    <img
      className={cx(styles.photo, shape !== 'card' && styles[shape], className)}
      src={photoSrc(url, size)}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => {
        setFailed(url);
      }}
    />
  );
}
