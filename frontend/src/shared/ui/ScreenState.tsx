import { Button, Spinner } from '@maxhub/max-ui';
import { useEffect, useState, type ReactNode } from 'react';
import { useCooldown } from '../useCooldown.ts';
import { cx } from './cx.ts';
import styles from './ScreenState.module.css';

export interface ScreenAction {
  label: string;
  onClick: () => void;
  loading?: boolean;
  disabled?: boolean;
}

type ScreenStateProps =
  | { status: 'loading'; label?: string; skeleton?: ReactNode }
  | {
      status: 'empty' | 'error';
      title: string;
      description?: ReactNode;
      action: ScreenAction;
      secondaryAction?: ScreenAction;
      tertiaryAction?: ScreenAction | undefined;
      error?: unknown;
    };

const LOADING_DELAY_MS = 300;

function useDelayed(active: boolean): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => {
      setShown(true);
    }, LOADING_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [active]);
  return active && shown;
}

export function ScreenState(props: ScreenStateProps) {
  const visible = useDelayed(props.status === 'loading');
  const wait = useCooldown(props.status === 'loading' ? null : props.error);
  if (props.status === 'loading') {
    if (!visible) return <div role="status" aria-busy="true" aria-label={props.label ?? 'Загрузка'} />;
    if (props.skeleton !== undefined) {
      return (
        <div aria-busy="true" aria-label={props.label ?? 'Загрузка'}>
          {props.skeleton}
        </div>
      );
    }
    return (
      <div className={styles.center} role="status" aria-label={props.label ?? 'Загрузка'}>
        <Spinner size={32} appearance="themed" />
        {props.label !== undefined && <p className={styles.description}>{props.label}</p>}
      </div>
    );
  }
  return (
    <section
      className={cx(styles.center, props.status === 'error' && styles.error)}
      role={props.status === 'error' ? 'alert' : undefined}
    >
      <span className={styles.mark} aria-hidden="true" />
      <h2 className={styles.title}>{props.title}</h2>
      {props.description !== undefined && <p className={styles.description}>{props.description}</p>}
      <div className={styles.actions}>
        <Button
          size="large"
          stretched
          onClick={props.action.onClick}
          loading={props.action.loading}
          disabled={props.action.disabled === true || wait > 0}
        >
          {wait > 0 ? `${props.action.label} через ${String(wait)} с` : props.action.label}
        </Button>
        {props.secondaryAction !== undefined && (
          <Button
            size="large"
            variant="secondary"
            stretched
            onClick={props.secondaryAction.onClick}
            loading={props.secondaryAction.loading}
            disabled={props.secondaryAction.disabled}
          >
            {props.secondaryAction.label}
          </Button>
        )}
        {props.tertiaryAction !== undefined && (
          <Button
            size="large"
            variant="ghost"
            stretched
            onClick={props.tertiaryAction.onClick}
            loading={props.tertiaryAction.loading}
            disabled={props.tertiaryAction.disabled}
          >
            {props.tertiaryAction.label}
          </Button>
        )}
      </div>
    </section>
  );
}
