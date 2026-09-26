import { setTimeout as delay } from 'node:timers/promises';
import {
  ChadGptError,
  type ChadGptClient,
  type ChadGptErrorKind,
  type CompletionRequest,
} from '../integrations/chadgpt/client.ts';
import { isVisionModel, type VisionModel } from '../integrations/chadgpt/models.ts';
import { prepareImage, UnsupportedImageError } from '../integrations/images/prepare.ts';
import type { UnavailableReason } from '../ports/recognition.ts';
import { readAnswer, type ResponseFormat } from './schemas.ts';

export interface RecognizerDeps {
  client: ChadGptClient;
  visionModel: VisionModel;
  fallbackModel: VisionModel;
  textModel: string;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const MAX_PROVIDER_CALLS = 3;
const RETRY_DELAY_MS = 1000;

const INVALID_ANSWERS_BEFORE_FALLBACK = 2;

const FAILURE_REASONS: Record<ChadGptErrorKind, UnavailableReason> = {
  timeout: 'timeout',
  quota: 'quota_exceeded',
  network: 'provider_error',
  server: 'provider_error',
  auth: 'provider_error',
  bad_request: 'provider_error',
  truncated: 'invalid_response',
  empty: 'invalid_response',
};

export type AnswerRequest = Omit<CompletionRequest, 'schemaName' | 'schema' | 'timeoutMs'>;

type AnswerResult<T> = { ok: true; answer: T; model: string } | { ok: false; reason: UnavailableReason };

type Attempt<T> =
  { kind: 'answer'; answer: T } | { kind: 'invalid' } | { kind: 'failed'; error: ChadGptError };

export function requireVisionModel(model: string): VisionModel {
  if (!isVisionModel(model)) {
    throw new Error(`Model ${model} is not known to read images`);
  }
  return model;
}

export function assertVisionModels(deps: Pick<RecognizerDeps, 'visionModel' | 'fallbackModel'>): void {
  requireVisionModel(deps.visionModel);
  requireVisionModel(deps.fallbackModel);
}

export async function preparePhoto(image: Buffer): Promise<Buffer | null> {
  try {
    return await prepareImage(image);
  } catch (error) {
    if (error instanceof UnsupportedImageError) return null;
    throw error;
  }
}

async function attempt<T>(
  deps: RecognizerDeps,
  request: CompletionRequest,
  format: ResponseFormat<T>,
): Promise<Attempt<T>> {
  let content: string;
  try {
    ({ content } = await deps.client.complete(request));
  } catch (error) {
    if (!(error instanceof ChadGptError)) throw error;
    return FAILURE_REASONS[error.kind] === 'invalid_response'
      ? { kind: 'invalid' }
      : { kind: 'failed', error };
  }
  const answer = readAnswer(content, format);
  return answer === null ? { kind: 'invalid' } : { kind: 'answer', answer };
}

export async function requestAnswer<T>(
  deps: RecognizerDeps,
  request: AnswerRequest,
  format: ResponseFormat<T>,
): Promise<AnswerResult<T>> {
  const sleep = deps.sleep ?? delay;
  let invalidAnswers = 0;
  let retriedFailure = false;
  let reason: UnavailableReason = 'invalid_response';
  for (let call = 1; call <= MAX_PROVIDER_CALLS; call += 1) {
    const model = invalidAnswers < INVALID_ANSWERS_BEFORE_FALLBACK ? request.model : deps.fallbackModel;
    const outcome = await attempt(
      deps,
      { ...request, model, schemaName: format.schemaName, schema: format.schema, timeoutMs: deps.timeoutMs },
      format,
    );
    if (outcome.kind === 'answer') return { ok: true, answer: outcome.answer, model };
    if (outcome.kind === 'invalid') {
      reason = 'invalid_response';
      invalidAnswers += 1;
      if (invalidAnswers > INVALID_ANSWERS_BEFORE_FALLBACK) break;
      continue;
    }
    reason = FAILURE_REASONS[outcome.error.kind];
    if (!outcome.error.retryable || retriedFailure) break;
    retriedFailure = true;
    if (call < MAX_PROVIDER_CALLS) await sleep(RETRY_DELAY_MS);
  }
  return { ok: false, reason };
}
