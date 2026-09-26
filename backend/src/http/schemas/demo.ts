import { z } from 'zod';
import { DEFAULT_DEMO_SOURCE_VENUE_ID, type DemoDiaryResult } from '../../services/demo.ts';
import { LocalDate } from './common.ts';

export const ClaimDemoVenueBody = z.object({
  sourceVenueId: z
    .number()
    .int()
    .positive()
    .default(DEFAULT_DEMO_SOURCE_VENUE_ID)
    .describe('Засеянное демо-заведение, копию которого получит пользователь; по умолчанию кофейня «Зерно»'),
});

export const DemoDiaryResultSchema = z
  .object({
    mealsAdded: z.number().int().describe('Сколько приёмов пищи добавлено'),
    fromDate: LocalDate.describe('Первый день примера YYYY-MM-DD в часовом поясе пользователя'),
    toDate: LocalDate.describe('Последний день примера YYYY-MM-DD, вчера в часовом поясе пользователя'),
  })
  .meta({ id: 'DemoDiaryResult', description: 'Пример дневника добавлен' });

export function toDemoDiaryResult(result: DemoDiaryResult): z.infer<typeof DemoDiaryResultSchema> {
  return { mealsAdded: result.mealsAdded, fromDate: result.fromDate, toDate: result.toDate };
}
