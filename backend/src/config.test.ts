import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.ts';

describe('loadConfig', () => {
  it('applies defaults for an empty environment', () => {
    const config = loadConfig({});
    expect(config).toMatchObject({
      NODE_ENV: 'development',
      HOST: '0.0.0.0',
      PORT: 3000,
      LOG_LEVEL: 'info',
      LOG_PRETTY: false,
      CORS_ORIGINS: [],
      RATE_LIMIT_PER_MINUTE: 300,
      TRUST_PROXY: false,
    });
  });

  it('parses numbers, flags and comma separated lists', () => {
    const config = loadConfig({
      PORT: '8080',
      LOG_PRETTY: 'yes',
      CORS_ORIGINS: 'https://a.example, https://b.example ,',
    });
    expect(config.PORT).toBe(8080);
    expect(config.LOG_PRETTY).toBe(true);
    expect(config.CORS_ORIGINS).toEqual(['https://a.example', 'https://b.example']);
  });

  it('treats empty strings as missing values', () => {
    const config = loadConfig({ LOG_PRETTY: '', CORS_ORIGINS: '' });
    expect(config.LOG_PRETTY).toBe(false);
    expect(config.CORS_ORIGINS).toEqual([]);
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
    }
  });
});
