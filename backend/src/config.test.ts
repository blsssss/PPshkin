import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.ts';

const required = { DATABASE_URL: 'postgres://user:pass@localhost:5432/db' };

describe('loadConfig', () => {
  it('applies defaults when only required variables are set', () => {
    const config = loadConfig(required);
    expect(config).toMatchObject({
      NODE_ENV: 'development',
      HOST: '0.0.0.0',
      PORT: 3000,
      LOG_LEVEL: 'info',
      LOG_PRETTY: false,
      CORS_ORIGINS: [],
      RATE_LIMIT_PER_MINUTE: 300,
      TRUST_PROXY: false,
      DATABASE_POOL_SIZE: 10,
      MIGRATE_ON_START: true,
      SESSION_TTL_HOURS: 12,
      INIT_DATA_MAX_AGE_SECONDS: 3600,
      DEMO_MODE: false,
    });
    expect(config.MAX_BOT_TOKEN).toBeUndefined();
    expect(config.PUBLIC_BASE_URL).toBeUndefined();
  });

  it('parses numbers, flags and comma separated lists', () => {
    const config = loadConfig({
      ...required,
      PORT: '8080',
      LOG_PRETTY: 'yes',
      CORS_ORIGINS: 'https://a.example, https://b.example ,',
    });
    expect(config.PORT).toBe(8080);
    expect(config.LOG_PRETTY).toBe(true);
    expect(config.CORS_ORIGINS).toEqual(['https://a.example', 'https://b.example']);
  });

  it('treats empty strings as missing values', () => {
    const config = loadConfig({ ...required, LOG_PRETTY: '', CORS_ORIGINS: '' });
    expect(config.LOG_PRETTY).toBe(false);
    expect(config.CORS_ORIGINS).toEqual([]);
  });

  it('rejects short secrets', () => {
    expect(() => loadConfig({ ...required, SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/);
    expect(() => loadConfig({ ...required, DEMO_GUEST_TOKEN: 'short' })).toThrow(/DEMO_GUEST_TOKEN/);
  });

  it('reports every invalid variable', () => {
    try {
      loadConfig({ PORT: 'abc', NODE_ENV: 'staging' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const issues = (error as ConfigError).issues.join('\n');
      expect(issues).toContain('PORT');
      expect(issues).toContain('NODE_ENV');
      expect(issues).toContain('DATABASE_URL');
    }
  });
});
