import type { Schemas } from '../../api/client.ts';

export type ComplaintReason = Schemas['ComplaintRequestInput']['reason'];

export const COMPLAINT_TEXT_LIMIT = 500;

export const COMPLAINT_REASONS: readonly { value: ComplaintReason; label: string }[] = [
  { value: 'not_served', label: 'Не выдали заказ по брони' },
  { value: 'price_mismatch', label: 'Цена на кассе другая' },
  { value: 'venue_closed', label: 'Заведение было закрыто' },
  { value: 'item_missing', label: 'Блюда не было в наличии' },
  { value: 'quality', label: 'Качество блюда' },
  { value: 'wrong_info', label: 'Неверные сведения о заведении или меню' },
  { value: 'other', label: 'Другое' },
];
