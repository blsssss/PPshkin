import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { cx } from './cx.ts';
import styles from './Toast.module.css';

export const TOAST_DURATION_MS = 4000;

export interface ToastOptions {
  tone?: 'default' | 'error';
  action?: { label: string; onClick: () => void };
}

interface ToastItem extends ToastOptions {
  id: number;
  message: string;
}

interface ToastApi {
  show(message: string, options?: ToastOptions): void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastItem | null>(null);
  const nextId = useRef(0);

  const show = useCallback((message: string, options: ToastOptions = {}) => {
    nextId.current += 1;
    setToast({ id: nextId.current, message, ...options });
  }, []);

  useEffect(() => {
    if (toast === null) return;
    const timer = setTimeout(() => {
      setToast((current) => (current?.id === toast.id ? null : current));
    }, TOAST_DURATION_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [toast]);

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext value={api}>
      {children}
      <div className={styles.region} role="status" aria-live="polite">
        {toast !== null && (
          <div key={toast.id} className={cx(styles.toast, toast.tone === 'error' && styles.error)}>
            <span className={styles.message}>{toast.message}</span>
            {toast.action !== undefined && (
              <button
                type="button"
                className={styles.action}
                onClick={() => {
                  toast.action?.onClick();
                  setToast(null);
                }}
              >
                {toast.action.label}
              </button>
            )}
          </div>
        )}
      </div>
    </ToastContext>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (context === null) throw new Error('useToast must be used inside ToastProvider');
  return context;
}
