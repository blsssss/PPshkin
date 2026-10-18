import { Counter, Histogram, type Metric } from 'prom-client';
import type { NotificationResult } from '../domain/notifications.ts';

export interface NotificationStats {
  finished(kind: string, result: NotificationResult): void;
  delivered(kind: string, delaySeconds: number): void;
  readonly metrics: readonly Metric[];
}

export function createNotificationStats(): NotificationStats {
  const total = new Counter({
    name: 'ppshkin_notifications_total',
    help: 'Notifications that reached a final status, by kind and result',
    labelNames: ['kind', 'result'] as const,
    registers: [],
  });
  const delay = new Histogram({
    name: 'ppshkin_notification_delay_seconds',
    help: 'Time from queueing a notification to its delivery to MAX',
    labelNames: ['kind'] as const,
    buckets: [1, 2, 5, 15, 30, 60, 300, 900, 1800, 3600],
    registers: [],
  });
  return {
    finished(kind, result) {
      total.inc({ kind, result });
    },
    delivered(kind, delaySeconds) {
      total.inc({ kind, result: 'sent' });
      delay.observe({ kind }, Math.max(0, delaySeconds));
    },
    metrics: [total, delay],
  };
}
