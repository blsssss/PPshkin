export const VISION_MODELS = ['gpt-6-luna', 'gpt-5.6-luna', 'gemini-3-flash-preview'] as const;
export type VisionModel = (typeof VISION_MODELS)[number];

export function isVisionModel(value: string): value is VisionModel {
  return (VISION_MODELS as readonly string[]).includes(value);
}
