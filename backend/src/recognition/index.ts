import { createChadGptClient, type ChadGptLogger } from '../integrations/chadgpt/client.ts';
import type { Recognition } from '../ports/recognition.ts';
import { createDishRecognizer, referenceRecognition } from './dish.ts';
import { createMenuParser, heuristicMenu } from './menu.ts';
import { requireVisionModel } from './structured.ts';

export interface RecognitionSettings {
  apiKey: string | undefined;
  baseUrl: string;
  visionModel: string;
  fallbackModel: string;
  timeoutMs: number;
  menuTimeoutMs: number;
  fetch?: typeof fetch;
  logger?: ChadGptLogger;
}

const DISABLED = { status: 'unavailable', reason: 'disabled' } as const;

function offlineRecognition(): Recognition {
  return {
    dishes: {
      fromPhoto: () => Promise.resolve(DISABLED),
      fromText: (description) => Promise.resolve(referenceRecognition(description) ?? DISABLED),
    },
    menus: {
      fromPhoto: () => Promise.resolve(DISABLED),
      fromText: (text) => Promise.resolve(heuristicMenu(text) ?? DISABLED),
    },
  };
}

export function createRecognition(settings: RecognitionSettings): Recognition {
  const primary = requireVisionModel(settings.visionModel);
  const fallback = requireVisionModel(settings.fallbackModel);
  if (!settings.apiKey) return offlineRecognition();
  const client = createChadGptClient({
    apiKey: settings.apiKey,
    baseUrl: settings.baseUrl,
    timeoutMs: settings.timeoutMs,
    fetch: settings.fetch,
    logger: settings.logger,
  });
  const deps = { client, visionModel: primary, fallbackModel: fallback, textModel: primary };
  return {
    dishes: createDishRecognizer({ ...deps, timeoutMs: settings.timeoutMs }),
    menus: createMenuParser({ ...deps, timeoutMs: settings.menuTimeoutMs }),
  };
}
