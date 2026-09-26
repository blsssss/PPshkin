import { z } from 'zod';
import type { MaxApi, MaxApiOptions } from '../integrations/max/api.ts';
import type { Recognition } from '../ports/recognition.ts';
import type { RecognitionSettings } from '../recognition/index.ts';
import type { Clock } from '../shared/clock.ts';

export const SMOKE_GROUPS = ['max', 'site', 'recognition', 'api'] as const;
export type SmokeGroup = (typeof SMOKE_GROUPS)[number];

export const SMOKE_STATUSES = ['ok', 'failed', 'skipped'] as const;
export type SmokeStatus = (typeof SMOKE_STATUSES)[number];

export interface SmokeResult {
  name: string;
  status: SmokeStatus;
  durationMs: number;
  details: string;
}

export interface SmokeOptions {
  checks: readonly SmokeGroup[];
  strict: boolean;
  env: Record<string, string | undefined>;
}

export type SmokeEnv = SmokeOptions['env'];

export interface SmokeDependencies {
  fetch: typeof fetch;
  createMaxApi: (options: MaxApiOptions) => Pick<MaxApi, 'getMe' | 'listSubscriptions'>;
  createRecognition: (settings: RecognitionSettings) => Recognition;
  readFile: (file: URL) => Promise<Buffer>;
  clock: Clock;
}

export interface SmokeContext {
  env: SmokeEnv;
  deps: SmokeDependencies;
}

export interface SmokeCheck {
  name: string;
  requires: readonly string[];
  run(values: readonly string[]): Promise<string>;
}

export class SmokeFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SmokeFailure';
  }
}

const CAUSE_DEPTH = 4;

export function smokeCheck<const Names extends readonly string[]>(
  name: string,
  requires: Names,
  run: (...values: { [Index in keyof Names]: string }) => Promise<string>,
): SmokeCheck {
  return {
    name,
    requires,
    run: (values) => run(...(values as { [Index in keyof Names]: string })),
  };
}

function causeChain(error: unknown): Error[] {
  const chain: Error[] = [];
  for (let current = error; current instanceof Error && chain.length < CAUSE_DEPTH; current = current.cause) {
    chain.push(current);
  }
  return chain;
}

export function errorCodes(error: unknown): string[] {
  const codes = causeChain(error).flatMap((link) =>
    'code' in link && typeof link.code === 'string' ? [link.code] : [],
  );
  return [...new Set(codes)];
}

export function describeError(error: unknown): string {
  if (error instanceof SmokeFailure) return error.message;
  if (error instanceof z.ZodError) {
    return error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');
  }
  const chain = causeChain(error);
  if (chain.length === 0) return String(error);
  const text = [...new Set(chain.map((link) => link.message))].join(': ');
  const codes = errorCodes(error);
  return codes.length > 0 ? `${text} (${codes.join(', ')})` : text;
}

export async function runCheck(
  check: SmokeCheck,
  { env, strict, clock }: { env: SmokeEnv; strict: boolean; clock: Clock },
): Promise<SmokeResult> {
  const values = check.requires.map((name) => env[name]?.trim() ?? '');
  const missing = check.requires.filter((_name, index) => values[index] === '');
  if (missing.length > 0) {
    return {
      name: check.name,
      status: strict ? 'failed' : 'skipped',
      durationMs: 0,
      details: `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set`,
    };
  }
  const started = clock.now().getTime();
  const elapsed = () => clock.now().getTime() - started;
  try {
    const details = await check.run(values);
    return { name: check.name, status: 'ok', durationMs: elapsed(), details };
  } catch (error) {
    return { name: check.name, status: 'failed', durationMs: elapsed(), details: describeError(error) };
  }
}
