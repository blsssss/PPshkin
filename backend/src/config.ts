import { z } from 'zod';
import { VISION_MODELS } from './integrations/chadgpt/models.ts';

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

const IP_OR_CIDR = /^[0-9a-f:.]+(\/\d{1,3})?$/i;

const trustProxySetting = z.string().transform((raw, context): boolean | number | string[] => {
  const value = raw.trim().toLowerCase();
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  const entries = value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (entries.length === 0 || !entries.every((item) => IP_OR_CIDR.test(item))) {
    context.addIssue({
      code: 'custom',
      message: 'expected true, false, a hop count or a list of IPs and CIDRs',
    });
    return z.NEVER;
  }
  return entries;
});

const baseSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  LOG_PRETTY: z.preprocess(emptyAsUndefined, booleanFlag.default(false)),
  CORS_ORIGINS: z.preprocess(emptyAsUndefined, commaList.default([])),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(300),
  TRUST_PROXY: z.preprocess(emptyAsUndefined, trustProxySetting.default(false)),
  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),
  MIGRATE_ON_START: z.preprocess(emptyAsUndefined, booleanFlag.default(true)),
  PUBLIC_BASE_URL: z.preprocess(emptyAsUndefined, z.url().optional()),
  MAX_BOT_TOKEN: z.preprocess(emptyAsUndefined, z.string().min(10).optional()),
  BOT_MODE: z.preprocess(emptyAsUndefined, z.enum(['polling', 'webhook', 'off']).default('polling')),
  MAX_API_BASE_URL: z.preprocess(
    emptyAsUndefined,
    z.url({ protocol: /^https?$/ }).default('https://platform-api2.max.ru'),
  ),
  MAX_WEBHOOK_SECRET: z.preprocess(
    emptyAsUndefined,
    z
      .string()
      .regex(/^[A-Za-z0-9_-]{5,256}$/, 'expected 5 to 256 latin letters, digits, "_" or "-"')
      .optional(),
  ),
  SESSION_SECRET: z.preprocess(emptyAsUndefined, z.string().min(32).optional()),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(12),
  INIT_DATA_MAX_AGE_SECONDS: z.coerce.number().int().min(60).max(86400).default(3600),
  DEMO_MODE: z.preprocess(emptyAsUndefined, booleanFlag.default(false)),
  DEMO_GUEST_TOKEN: z.preprocess(emptyAsUndefined, z.string().min(24).optional()),
  DEMO_VENUE_TOKEN: z.preprocess(emptyAsUndefined, z.string().min(24).optional()),
  CHADGPT_API_KEY: z.preprocess(emptyAsUndefined, z.string().trim().min(1).optional()),
  CHADGPT_BASE_URL: z.preprocess(
    emptyAsUndefined,
    z.url({ protocol: /^https$/ }).default('https://ask.chadgpt.ru/api/v1'),
  ),
  CHADGPT_MODEL: z.preprocess(emptyAsUndefined, z.enum(VISION_MODELS).default('gpt-6-luna')),
  CHADGPT_FALLBACK_MODEL: z.preprocess(
    emptyAsUndefined,
    z.enum(VISION_MODELS).default('gemini-3-flash-preview'),
  ),
  CHADGPT_TIMEOUT_MS: z.preprocess(
    emptyAsUndefined,
    z.coerce.number().int().min(1000).max(300_000).default(45_000),
  ),
  CHADGPT_MENU_TIMEOUT_MS: z.preprocess(
    emptyAsUndefined,
    z.coerce.number().int().min(1000).max(600_000).default(120_000),
  ),
});

function isHttpsWithoutPort(url: string): boolean {
  const authority = /^https:\/\/([^/?#]*)/i.exec(url)?.[1];
  return authority !== undefined && !/:\d*$/.test(authority);
}

export const configSchema = baseSchema.superRefine((config, context) => {
  const hasDemoToken = Boolean(config.DEMO_GUEST_TOKEN ?? config.DEMO_VENUE_TOKEN);
  if (config.DEMO_MODE && !hasDemoToken) {
    context.addIssue({
      code: 'custom',
      path: ['DEMO_MODE'],
      message: 'DEMO_MODE=true needs DEMO_GUEST_TOKEN or DEMO_VENUE_TOKEN',
    });
  }
  if (!config.DEMO_MODE && hasDemoToken) {
    context.addIssue({
      code: 'custom',
      path: ['DEMO_MODE'],
      message: 'demo tokens are set but DEMO_MODE is not true',
    });
  }
  if (config.BOT_MODE === 'webhook') {
    const missing = (['MAX_BOT_TOKEN', 'MAX_WEBHOOK_SECRET', 'PUBLIC_BASE_URL'] as const).filter(
      (name) => config[name] === undefined,
    );
    for (const name of missing) {
      context.addIssue({ code: 'custom', path: [name], message: `BOT_MODE=webhook needs ${name}` });
    }
    const publicUrl = config.PUBLIC_BASE_URL;
    if (publicUrl !== undefined && !isHttpsWithoutPort(publicUrl)) {
      context.addIssue({
        code: 'custom',
        path: ['PUBLIC_BASE_URL'],
        message: 'BOT_MODE=webhook needs an https PUBLIC_BASE_URL without an explicit port',
      });
    }
  }
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
