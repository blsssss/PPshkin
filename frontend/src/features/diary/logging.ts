import { unwrap } from '../../api/client.ts';
import { isApiError, NETWORK_ERROR, TIMEOUT_ERROR } from '../../api/errors.ts';
import { api } from '../../api/index.ts';
import type { MealLogResult } from './queries.ts';

export type LogSource = 'photo' | 'text';

type UnavailableReason = Extract<MealLogResult, { status: 'unavailable' }>['reason'];

const RECOGNITION_FAILED = 'Сервис распознавания не ответил. Попробуйте позже или введите блюдо вручную';
const DESCRIPTION_NOT_RECOGNISED = 'Не удалось распознать описание. Введите блюдо вручную';

export const UNAVAILABLE_TEXTS: Record<LogSource, Record<UnavailableReason, string>> = {
  photo: {
    disabled: 'Распознавание фото сейчас выключено. Опишите блюдо словами или введите вручную',
    timeout: 'Не успели распознать фото. Попробуйте ещё раз или опишите блюдо словами',
    provider_error: RECOGNITION_FAILED,
    invalid_response: RECOGNITION_FAILED,
    quota_exceeded: RECOGNITION_FAILED,
    unsupported_image: 'Не удалось прочитать изображение. Пришлите фото в JPEG или PNG',
  },
  text: {
    disabled: DESCRIPTION_NOT_RECOGNISED,
    timeout: 'Не успели распознать описание. Попробуйте ещё раз или введите блюдо вручную',
    provider_error: RECOGNITION_FAILED,
    invalid_response: RECOGNITION_FAILED,
    quota_exceeded: RECOGNITION_FAILED,
    unsupported_image: DESCRIPTION_NOT_RECOGNISED,
  },
};

export function isLostResponse(error: unknown): boolean {
  return isApiError(error, TIMEOUT_ERROR) || isApiError(error, NETWORK_ERROR);
}

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
