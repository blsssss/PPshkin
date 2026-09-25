import { z } from 'zod';

const booleanFlag = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((value) => value === 'true' || value === '1' || value === 'yes');

const commaList = z.string().transform((value) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0),
);

const emptyAsUndefined = (value: unknown) => (value === '' ? undefined : value);

export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  LOG_PRETTY: z.preprocess(emptyAsUndefined, booleanFlag.default(false)),
  CORS_ORIGINS: z.preprocess(emptyAsUndefined, commaList.default([])),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(300),
  TRUST_PROXY: z.preprocess(emptyAsUndefined, booleanFlag.default(false)),
  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),
  MIGRATE_ON_START: z.preprocess(emptyAsUndefined, booleanFlag.default(true)),
  PUBLIC_BASE_URL: z.preprocess(emptyAsUndefined, z.url().optional()),
  MAX_BOT_TOKEN: z.preprocess(emptyAsUndefined, z.string().min(10).optional()),
  SESSION_SECRET: z.preprocess(emptyAsUndefined, z.string().min(32).optional()),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(12),
  INIT_DATA_MAX_AGE_SECONDS: z.coerce.number().int().min(60).max(604800).default(3600),
  DEMO_MODE: z.preprocess(emptyAsUndefined, booleanFlag.default(false)),
  DEMO_GUEST_TOKEN: z.preprocess(emptyAsUndefined, z.string().min(24).optional()),
  DEMO_VENUE_TOKEN: z.preprocess(emptyAsUndefined, z.string().min(24).optional()),
});

export type Config = z.infer<typeof configSchema>;

export class ConfigError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid configuration: ${issues.join('; ')}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    throw new ConfigError(result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`));
  }
  return result.data;
}
