import { unwrap } from '../../api/client.ts';
import { api } from '../../api/index.ts';
import type { MealLogResult } from './queries.ts';

type UnavailableReason = Extract<MealLogResult, { status: 'unavailable' }>['reason'];

export const UNAVAILABLE_TEXTS: Record<UnavailableReason, string> = {
  disabled: 'Распознавание фото сейчас выключено. Опишите блюдо словами или введите вручную',
  timeout: 'Не успели распознать фото. Попробуйте ещё раз или опишите блюдо словами',
  provider_error: 'Сервис распознавания не ответил. Попробуйте позже или введите блюдо вручную',
  invalid_response: 'Сервис распознавания не ответил. Попробуйте позже или введите блюдо вручную',
  quota_exceeded: 'Сервис распознавания не ответил. Попробуйте позже или введите блюдо вручную',
  unsupported_image: 'Не удалось прочитать изображение. Пришлите фото в JPEG или PNG',
};

export async function logPhoto(file: File): Promise<MealLogResult> {
  return unwrap(
    await api.POST('/api/v1/diary/meals/photo', {
      body: { image: '' },
      bodySerializer: () => {
        const form = new FormData();
        form.append('image', file);
        return form;
      },
    }),
  );
}

export async function logText(description: string): Promise<MealLogResult> {
  return unwrap(await api.POST('/api/v1/diary/meals/text', { body: { description } }));
}
