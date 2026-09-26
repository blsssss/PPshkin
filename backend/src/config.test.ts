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

  it('parses the trusted proxy setting', () => {
    expect(loadConfig({ ...required, TRUST_PROXY: 'true' }).TRUST_PROXY).toBe(true);
    expect(loadConfig({ ...required, TRUST_PROXY: '2' }).TRUST_PROXY).toBe(2);
    expect(loadConfig({ ...required, TRUST_PROXY: '10.0.0.0/8, 127.0.0.1' }).TRUST_PROXY).toEqual([
      '10.0.0.0/8',
      '127.0.0.1',
    ]);
    expect(() => loadConfig({ ...required, TRUST_PROXY: 'everyone' })).toThrow(/TRUST_PROXY/);
  });

  it('keeps demo mode and demo tokens consistent', () => {
    const token = 'demo-token-0123456789-abcdef';
    expect(loadConfig({ ...required, DEMO_MODE: 'true', DEMO_GUEST_TOKEN: token }).DEMO_MODE).toBe(true);
    expect(() => loadConfig({ ...required, DEMO_MODE: 'true' })).toThrow(/DEMO_MODE/);
    expect(() => loadConfig({ ...required, DEMO_VENUE_TOKEN: token })).toThrow(/DEMO_MODE/);
  });

  it('caps the init data lifetime at one day', () => {
    expect(() => loadConfig({ ...required, INIT_DATA_MAX_AGE_SECONDS: '604800' })).toThrow(
      /INIT_DATA_MAX_AGE_SECONDS/,
    );
  });

  it('rejects short secrets', () => {
    expect(() => loadConfig({ ...required, SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/);
    expect(() => loadConfig({ ...required, DEMO_MODE: 'true', DEMO_GUEST_TOKEN: 'short' })).toThrow(
      /DEMO_GUEST_TOKEN/,
    );
  });

  it('configures ChadGPT with safe defaults and no key', () => {
    const config = loadConfig({
      ...required,
      CHADGPT_API_KEY: '',
      CHADGPT_MODEL: '',
      CHADGPT_TIMEOUT_MS: '',
    });
    expect(config).toMatchObject({
      CHADGPT_BASE_URL: 'https://ask.chadgpt.ru/api/v1',
      CHADGPT_MODEL: 'gpt-6-luna',
      CHADGPT_FALLBACK_MODEL: 'gemini-3-flash-preview',
      CHADGPT_TIMEOUT_MS: 45_000,
      CHADGPT_MENU_TIMEOUT_MS: 120_000,
    });
    expect(config.CHADGPT_API_KEY).toBeUndefined();
    expect(loadConfig(required).CHADGPT_API_KEY).toBeUndefined();
  });

  it('reads the ChadGPT settings', () => {
    const config = loadConfig({
      ...required,
      CHADGPT_API_KEY: ' chad-key-0123456789 ',
      CHADGPT_BASE_URL: 'https://proxy.example/api/v1',
      CHADGPT_MODEL: 'gpt-5.6-luna',
      CHADGPT_FALLBACK_MODEL: 'gpt-6-luna',
      CHADGPT_TIMEOUT_MS: '30000',
      CHADGPT_MENU_TIMEOUT_MS: '600000',
    });
    expect(config).toMatchObject({
      CHADGPT_API_KEY: 'chad-key-0123456789',
      CHADGPT_BASE_URL: 'https://proxy.example/api/v1',
      CHADGPT_MODEL: 'gpt-5.6-luna',
      CHADGPT_FALLBACK_MODEL: 'gpt-6-luna',
      CHADGPT_TIMEOUT_MS: 30_000,
      CHADGPT_MENU_TIMEOUT_MS: 600_000,
    });
  });

  it('accepts only models that read images', () => {
    expect(() => loadConfig({ ...required, CHADGPT_MODEL: 'deepseek-v4-flash' })).toThrow(/CHADGPT_MODEL/);
    expect(() => loadConfig({ ...required, CHADGPT_FALLBACK_MODEL: 'gpt-5-nano' })).toThrow(
      /CHADGPT_FALLBACK_MODEL/,
    );
  });

  it('sends the key only over HTTPS', () => {
    expect(() => loadConfig({ ...required, CHADGPT_BASE_URL: 'http://ask.chadgpt.ru/api/v1' })).toThrow(
      /CHADGPT_BASE_URL/,
    );
    expect(() => loadConfig({ ...required, CHADGPT_BASE_URL: 'not a url' })).toThrow(/CHADGPT_BASE_URL/);
  });

  it.each([
    ['CHADGPT_TIMEOUT_MS', '1000', true],
    ['CHADGPT_TIMEOUT_MS', '999', false],
    ['CHADGPT_TIMEOUT_MS', '300000', true],
    ['CHADGPT_TIMEOUT_MS', '300001', false],
    ['CHADGPT_TIMEOUT_MS', '1500.5', false],
    ['CHADGPT_MENU_TIMEOUT_MS', '1000', true],
    ['CHADGPT_MENU_TIMEOUT_MS', '999', false],
    ['CHADGPT_MENU_TIMEOUT_MS', '600000', true],
    ['CHADGPT_MENU_TIMEOUT_MS', '600001', false],
  ])('checks the bounds of %s=%s', (name, value, valid) => {
    const load = () => loadConfig({ ...required, [name]: value });
    if (valid) expect(load()).toHaveProperty(name, Number(value));
    else expect(load).toThrow(new RegExp(name));
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
