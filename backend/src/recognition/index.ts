import type { Recognition } from '../ports/recognition.ts';

export function disabledRecognition(): Recognition {
  const unavailable = () => Promise.resolve({ status: 'unavailable', reason: 'disabled' } as const);
  return {
    dishes: { fromPhoto: unavailable, fromText: unavailable },
    menus: { fromPhoto: unavailable, fromText: unavailable },
  };
}
