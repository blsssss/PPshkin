import type { MaxBotCommand } from '../integrations/max/types.ts';

export const BOT_COMMANDS: readonly MaxBotCommand[] = [
  { name: 'start', description: 'Начать и настроить' },
  { name: 'eat', description: 'Что поесть рядом' },
  { name: 'today', description: 'Дневник за сегодня' },
  { name: 'bookings', description: 'Мои брони' },
  { name: 'profile', description: 'Профиль и настройки' },
  { name: 'venue', description: 'Кабинет заведения' },
  { name: 'help', description: 'Помощь' },
  { name: 'delete', description: 'Удалить аккаунт и данные' },
];
