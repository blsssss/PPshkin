import type { MaxBotCommand } from '../integrations/max/types.ts';

export const BOT_COMMANDS: readonly MaxBotCommand[] = [
  { name: 'start', description: 'Начать и настроить' },
  { name: 'today', description: 'Дневник за сегодня' },
  { name: 'profile', description: 'Профиль и настройки' },
  { name: 'help', description: 'Помощь' },
  { name: 'delete', description: 'Удалить аккаунт и данные' },
];
