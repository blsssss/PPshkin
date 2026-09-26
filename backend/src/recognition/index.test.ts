import { describe, expect, it } from 'vitest';
import { disabledRecognition } from './index.ts';

describe('disabledRecognition', () => {
  it('reports every recognition as disabled', async () => {
    const recognition = disabledRecognition();
    const image = Buffer.from('x');
    await expect(recognition.dishes.fromPhoto(image)).resolves.toEqual({
      status: 'unavailable',
      reason: 'disabled',
    });
    await expect(recognition.dishes.fromText('борщ')).resolves.toEqual({
      status: 'unavailable',
      reason: 'disabled',
    });
    await expect(recognition.menus.fromPhoto(image)).resolves.toEqual({
      status: 'unavailable',
      reason: 'disabled',
    });
    await expect(recognition.menus.fromText('Эклер 150')).resolves.toEqual({
      status: 'unavailable',
      reason: 'disabled',
    });
  });
});
