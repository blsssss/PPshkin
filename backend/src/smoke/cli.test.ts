import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeMaxApi } from '../../test/max-api.ts';
import { fakeRecognition, fakeSmokeDependencies } from '../../test/smoke.ts';
import type { SmokeDependencies } from './check.ts';
import { parseSmokeArgs, runSmokeCli } from './cli.ts';

const ALL = ['max', 'site', 'recognition', 'api'];
const USAGE = 'usage: npm run smoke -- [--checks all|max,site,recognition,api] [--strict]\n';

function cliDependencies(overrides: Partial<Omit<SmokeDependencies, 'clock'>> = {}) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const summary: [string, string][] = [];
  const deps = {
    ...fakeSmokeDependencies(overrides),
    appendFile: vi.fn((path: string, text: string) => {
      summary.push([path, text]);
      return Promise.resolve();
    }),
    stdout: { write: (text: string) => stdout.push(text) },
    stderr: { write: (text: string) => stderr.push(text) },
  };
  return { deps, stdout, stderr, summary };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseSmokeArgs', () => {
  it.each<[string[], string[], boolean]>([
    [[], ALL, false],
    [['--strict'], ALL, true],
    [['--checks', 'max,site'], ['max', 'site'], false],
    [['--checks=api,max', '--strict'], ['max', 'api'], true],
    [['--checks', ' recognition , api ,'], ['recognition', 'api'], false],
    [['--checks', 'api,api'], ['api'], false],
    [['--checks', 'max,all'], ALL, false],
    [['--checks', 'all', '--strict'], ALL, true],
  ])('reads %j', (argv, checks, strict) => {
    expect(parseSmokeArgs(argv)).toEqual({ checks, strict });
  });

  it.each<[string[], string]>([
    [['--checks', 'maxx,site'], 'unknown checks: maxx; expected all or max, site, recognition, api'],
    [['--checks', ' , '], '--checks needs all or a comma list of max, site, recognition, api'],
    [['--checks'], "Option '--checks <value>' argument missing"],
    [['--verbose'], "Unknown option '--verbose'"],
    [['max'], "Unexpected argument 'max'"],
    [['--strict=yes'], "Option '--strict' does not take an argument"],
  ])('rejects %j', (argv, message) => {
    expect(() => parseSmokeArgs(argv)).toThrow(message);
  });
});

describe('runSmokeCli', () => {
  it('prints the report and exits with 0 when nothing failed', async () => {
    const { deps, stdout, stderr, summary } = cliDependencies();

    await expect(runSmokeCli(['--checks', 'site'], {}, deps)).resolves.toBe(0);

    expect(stdout.join('')).toContain('| site.health | skipped | - | PUBLIC_BASE_URL is not set |');
    expect(stdout.join('')).toContain('Итого: ok 0, failed 0, skipped 3');
    expect(stderr).toEqual([]);
    expect(summary).toEqual([]);
  });

  it('exits with 1 under --strict without variables and appends the report to GITHUB_STEP_SUMMARY', async () => {
    const { deps, stdout, summary } = cliDependencies();
    const env = { GITHUB_STEP_SUMMARY: '/runner/step-summary.md' };

    await expect(runSmokeCli(['--checks', 'recognition', '--strict'], env, deps)).resolves.toBe(1);

    expect(stdout.join('')).toContain('| recognition.photo | failed | 0 ms | CHADGPT_API_KEY is not set |');
    expect(summary).toEqual([['/runner/step-summary.md', stdout.join('')]]);
  });

  it('rejects bad arguments with the usage and exit code 2 without running checks', async () => {
    const { deps, stdout, stderr } = cliDependencies();

    await expect(
      runSmokeCli(['--checks', 'db'], { PUBLIC_BASE_URL: 'https://x.example' }, deps),
    ).resolves.toBe(2);

    expect(stderr.join('')).toBe(`unknown checks: db; expected all or max, site, recognition, api\n${USAGE}`);
    expect(stdout).toEqual([]);
    expect(deps.fetch).not.toHaveBeenCalled();
  });
});

describe('secrets in the smoke output', () => {
  const SECRETS = {
    MAX_BOT_TOKEN: 'max-bot-token-SECRET-0123456789',
    CHADGPT_API_KEY: 'chadgpt-key-SECRET-0123456789',
    DEMO_GUEST_TOKEN: 'demo-guest-token-SECRET-0123456789abcdef',
    DEMO_VENUE_TOKEN: 'demo-venue-token-SECRET-0123456789abcdef',
  };
  const ENV = {
    ...SECRETS,
    MAX_BOT_USERNAME: 'ppshkin_bot',
    PUBLIC_BASE_URL: 'https://ppshkin.example',
    GITHUB_STEP_SUMMARY: '/runner/step-summary.md',
  };
  const everySecret = Object.values(SECRETS).join(' ');

  function leakyDependencies() {
    return cliDependencies({
      fetch: vi.fn<typeof fetch>((_input, init) => {
        const authorization = new Headers(init?.headers).get('authorization') ?? 'no authorization';
        return Promise.reject(new Error(`request with ${authorization} failed near ${everySecret}`));
      }),
      createMaxApi: ({ token }) =>
        fakeMaxApi({
          getMe: vi.fn(() => Promise.resolve({ user_id: 1, first_name: 'Bot', username: `bot-${token}` })),
          listSubscriptions: vi.fn(() => Promise.reject(new Error(`token ${token} is not valid`))),
        }),
      createRecognition: ({ apiKey }) =>
        fakeRecognition({
          dishes: {
            fromPhoto: vi.fn(() =>
              Promise.resolve({
                status: 'recognized' as const,
                items: [
                  {
                    title: `dish for ${apiKey ?? ''}`,
                    portionG: null,
                    kcalMin: 100,
                    kcalMax: 200,
                    proteinG: 1,
                    fatG: 1,
                    carbsG: 1,
                    tags: [],
                    confidence: 0.5,
                  },
                ],
                basis: '',
                model: `model-${apiKey ?? ''}`,
              }),
            ),
            fromText: vi.fn(() => Promise.reject(new Error(`key ${apiKey ?? ''} was refused`))),
          },
          menus: {
            fromText: vi.fn(() => Promise.reject(new Error(`menu for ${everySecret}`))),
          },
        }),
    });
  }

  it('never writes known token and key values to the report, stdout, stderr or the step summary', async () => {
    const processOutput: string[] = [];
    const capture = (chunk: string | Uint8Array) => {
      processOutput.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
      return true;
    };
    vi.spyOn(process.stdout, 'write').mockImplementation(capture);
    vi.spyOn(process.stderr, 'write').mockImplementation(capture);
    const { deps, stdout, stderr, summary } = leakyDependencies();

    const code = await runSmokeCli(['--checks', 'all', '--strict'], ENV, deps);
    await runSmokeCli(['--checks', SECRETS.MAX_BOT_TOKEN], ENV, deps);

    const output = [...stdout, ...stderr, ...summary.flat(), ...processOutput].join('\n');
    expect(code).toBe(1);
    expect(stdout.join('')).toContain('[redacted]');
    expect(stderr.join('')).toContain('unknown checks: [redacted]');
    expect(Object.values(SECRETS).filter((secret) => output.includes(secret))).toEqual([]);
  });
});
