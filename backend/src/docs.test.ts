import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { configSchema, loadConfig } from './config.ts';
import { CONSENT_DOCUMENTS } from './domain/consents.ts';

const repo = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, repo), 'utf8');

const README_SECTIONS = [
  'Назначение',
  'Основной сценарий',
  'Состав и архитектура',
  'Быстрый запуск',
  'Требования к окружению',
  'Переменные окружения',
  'Порты',
  'Зависимости',
  'Внешние сервисы и интеграции',
  'Работа с данными',
  'Тестовые данные',
  'Сценарий проверки',
  'Примеры ожидаемого поведения',
  'Известные ограничения',
  'Остановка и перезапуск',
  'Сервисы вне Docker',
];
const SECRETS = ['MAX_BOT_TOKEN', 'SESSION_SECRET', 'MAX_WEBHOOK_SECRET', 'CHADGPT_API_KEY'];
const VITE_BUILD_MODE_VARIABLE = 'NODE_ENV';
const LOCAL_DEMO_TOKENS = {
  DEMO_GUEST_TOKEN: 'local-demo-guest-token-not-secret',
  DEMO_VENUE_TOKEN: 'local-demo-venue-token-not-secret',
};
const BANNERS = ['docs/assets/banner-light.svg', 'docs/assets/banner-dark.svg'];
const BANNER_MAX_BYTES = 150 * 1024;
const LONG_DASHES = [0x2013, 0x2014];
const LINK_TARGETS = [
  /\]\(\s*<?([^\s)>]+)/g,
  /^ {0,3}\[[^\]]+\]:\s*<?([^\s>]+)/gm,
  /\b(?:href|src)\s*=\s*["']([^"']+)["']/gi,
];
const configKeys = Object.keys(configSchema.shape);

function withoutFencedCode(markdown: string): string {
  let fence: string | undefined;
  return markdown
    .split(/\r?\n/)
    .map((line) => {
      if (fence === undefined) {
        const opening = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
        if (opening === undefined) return line;
        fence = opening;
        return '';
      }
      const closing = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line)?.[1];
      if (closing?.startsWith(fence)) fence = undefined;
      return '';
    })
    .join('\n');
}

function secondLevelHeadings(markdown: string): string[] {
  return [...withoutFencedCode(markdown).matchAll(/^## +(.+?)[ \t]*$/gm)].map((match) => match[1] ?? '');
}

function section(markdown: string, heading: string): string {
  const lines = withoutFencedCode(markdown).split('\n');
  const start = lines.findIndex((line) => line.trimEnd() === `## ${heading}`);
  if (start === -1) return '';
  const end = lines.findIndex((line, index) => index > start && /^#{1,2} /.test(line));
  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n');
}

function relativeLinks(markdown: string): string[] {
  const text = withoutFencedCode(markdown).replace(/`[^`\n]*`/g, '');
  return LINK_TARGETS.flatMap((pattern) => [...text.matchAll(pattern)].map((match) => match[1] ?? ''))
    .filter((target) => !/^[a-z][a-z\d+.-]*:/i.test(target) && !target.startsWith('//'))
    .map((target) => target.replace(/[?#].*$/, ''))
    .filter((target) => target.length > 0);
}

function exists(target: string, from: string): boolean {
  try {
    return existsSync(new URL(target, new URL(from, repo)));
  } catch {
    return false;
  }
}

function srcsetTargets(markdown: string): string[] {
  const text = withoutFencedCode(markdown);
  return [...text.matchAll(/\bsrcset\s*=\s*["']([^"']+)["']/gi)].flatMap((match) =>
    (match[1] ?? '').split(',').map((candidate) => candidate.trim().split(/\s+/)[0] ?? ''),
  );
}

function externalReferences(svg: string): string[] {
  const hrefs = [...svg.matchAll(/\b(?:xlink:)?href\s*=\s*["']([^"']*)["']/gi)].map(
    (match) => match[1] ?? '',
  );
  const urls = [...svg.matchAll(/url\(\s*["']?([^"')]*)/gi)].map((match) => match[1]?.trim() ?? '');
  return [...hrefs, ...urls].filter((target) => !target.startsWith('#'));
}

function bannerProblems(svg: string): string[] {
  const checks: [string, boolean][] = [
    [`larger than ${BANNER_MAX_BYTES} bytes`, Buffer.byteLength(svg) > BANNER_MAX_BYTES],
    ['no viewBox', !/<svg\b[^>]*\bviewBox="[^"]+"/.test(svg)],
    ['no title', !/<title\b[^>]*>[^<]+<\/title>/.test(svg)],
    [
      'script, foreignObject, image, text or a web font',
      /<(?:[\w-]+:)?(?:script|foreignObject|image|text)\b|@import|@font-face/i.test(svg),
    ],
    ['long dash', LONG_DASHES.some((code) => svg.includes(String.fromCodePoint(code)))],
  ];
  return [...checks.filter(([, failed]) => failed).map(([problem]) => problem), ...externalReferences(svg)];
}

function envExampleLines(): string[] {
  return read('.env.example')
    .split('\n')
    .filter((line) => line.length > 0);
}

function envExample(): Map<string, string> {
  return new Map(
    envExampleLines().map((line) => {
      const separator = line.indexOf('=');
      return [line.slice(0, separator), line.slice(separator + 1)];
    }),
  );
}

function markdownFiles(): string[] {
  const docs = readdirSync(new URL('docs/', repo)).filter((name) => name.endsWith('.md'));
  return ['README.md', ...docs.map((name) => `docs/${name}`)];
}

describe('README.md', () => {
  it('has every second-level section required by the brief', () => {
    const headings = secondLevelHeadings(read('README.md'));
    expect(README_SECTIONS.filter((heading) => !headings.includes(heading))).toEqual([]);
  });

  it('keeps the required sections once each and in the order of the brief', () => {
    const headings = secondLevelHeadings(read('README.md'));
    expect(headings.filter((heading) => README_SECTIONS.includes(heading))).toEqual(README_SECTIONS);
  });

  it('lists every backend variable in the environment variables table', () => {
    const rows = section(read('README.md'), 'Переменные окружения')
      .split('\n')
      .filter((line) => line.trimStart().startsWith('|'));
    expect(configKeys.filter((key) => !rows.some((row) => row.includes(`\`${key}\``)))).toEqual([]);
  });
});

describe('README.md banner', () => {
  it('shows the dark banner in the dark theme and the light one everywhere else', () => {
    const readme = withoutFencedCode(read('README.md'));
    expect(readme).toMatch(
      /media="\(prefers-color-scheme: dark\)"\s+srcset="docs\/assets\/banner-dark\.svg"/,
    );
    expect(readme).toMatch(/<img src="docs\/assets\/banner-light\.svg"/);
  });

  it('points every srcset only to files that exist', () => {
    const targets = srcsetTargets(read('README.md'));
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.filter((target) => !exists(target, 'README.md'))).toEqual([]);
  });

  it.each(BANNERS)('%s is a self-contained SVG with outlined text', (path) => {
    expect(bannerProblems(read(path))).toEqual([]);
  });
});

describe('.env.example', () => {
  it('leaves out NODE_ENV, because Vite reads the root .env and NODE_ENV=development makes a development build', () => {
    expect(envExample().has(VITE_BUILD_MODE_VARIABLE)).toBe(false);
    expect(configKeys).toContain(VITE_BUILD_MODE_VARIABLE);
  });

  it('defines every other backend, compose and frontend build variable', () => {
    const defined = envExample();
    const composeVariables = ['compose.yaml', 'compose.prod.yaml'].flatMap((path) =>
      [...read(path).matchAll(/(?<!\$)\$\{([A-Z][A-Z0-9_]*)/g)].map((match) => match[1] ?? ''),
    );
    const frontendVariables = [...read('frontend/src/vite-env.d.ts').matchAll(/\bVITE_[A-Z0-9_]+/g)].map(
      (match) => match[0],
    );
    expect(composeVariables).toContain('POSTGRES_PASSWORD');
    expect(frontendVariables).toContain('VITE_DEMO_MODE');
    const missing = [...configKeys, ...composeVariables, ...frontendVariables].filter(
      (key) => key !== VITE_BUILD_MODE_VARIABLE && !defined.has(key),
    );
    expect([...new Set(missing)]).toEqual([]);
  });

  it('holds only unique KEY=value lines without comments', () => {
    const lines = envExampleLines();
    expect(lines.filter((line) => !/^[A-Z][A-Z0-9_]*=\S*$/.test(line))).toEqual([]);
    expect(envExample().size).toBe(lines.length);
  });

  it('starts the backend locally in demo mode without the bot', () => {
    const config = loadConfig(Object.fromEntries(envExample()));
    expect(config).toMatchObject({ DEMO_MODE: true, BOT_MODE: 'off', ...LOCAL_DEMO_TOKENS });
    expect(envExample().get('VITE_DEMO_MODE')).toBe('true');
  });

  it('keeps every secret empty', () => {
    const defined = envExample();
    expect(SECRETS.filter((key) => defined.get(key) !== '')).toEqual([]);
  });
});

describe('compose.yaml', () => {
  it('runs the demo stack by default and lets an empty token in .env switch demo mode off', () => {
    const compose = parse(read('compose.yaml')) as {
      services: { backend: { environment: Record<string, unknown> } };
    };
    const environment = compose.services.backend.environment;
    expect(environment).toMatchObject({ DEMO_MODE: '${DEMO_MODE:-true}', BOT_MODE: '${BOT_MODE:-off}' });
    const tokens = Object.entries(LOCAL_DEMO_TOKENS).filter(
      ([name, token]) => environment[name] !== `\${${name}-${token}}`,
    );
    expect(tokens.map(([name]) => name)).toEqual([]);
  });
});

describe('docs/privacy.md', () => {
  it('quotes every consent document with its title and version', () => {
    const privacy = read('docs/privacy.md');
    const missing = Object.entries(CONSENT_DOCUMENTS).flatMap(([kind, document]) =>
      [document.title, document.version, ...document.text.split('\n\n')]
        .filter((fragment) => !privacy.includes(fragment))
        .map((fragment) => `${kind}: ${fragment}`),
    );
    expect(missing).toEqual([]);
  });
});

describe('README.md and docs/*.md', () => {
  it('avoid long dash characters', () => {
    const found = markdownFiles().flatMap((path) => {
      const text = read(path);
      return LONG_DASHES.filter((code) => text.includes(String.fromCodePoint(code))).map(
        (code) => `${path}: U+${code.toString(16).toUpperCase()}`,
      );
    });
    expect(found).toEqual([]);
  });

  it('link only to files that exist', () => {
    const broken = markdownFiles().flatMap((path) =>
      relativeLinks(read(path))
        .filter((target) => !exists(target, path))
        .map((target) => `${path}: ${target}`),
    );
    expect(broken).toEqual([]);
  });
});

describe('markdown helpers', () => {
  const sample = [
    '# Title',
    '## First',
    'See [guide](docs/guide.md#setup), [site](https://example.com), [mail](mailto:team@example.com) and [top](#first).',
    '![shot](docs/screenshots/a.png "Screen") and <img src="docs/b.png"> and `[code](not/a/link.md)`',
    '[ref]: ../outside.md?raw=1',
    '```bash',
    '## Not a heading',
    '[fenced](fenced.md)',
    '```',
    '### Nested',
    '| `KEY` | value |',
    '## Second',
    '| `OTHER` | value |',
  ].join('\n');

  it('reads second-level headings outside code blocks', () => {
    expect(secondLevelHeadings(sample)).toEqual(['First', 'Second']);
  });

  it('keeps nested headings inside a section and stops at the next one', () => {
    expect(section(sample, 'First')).toContain('`KEY`');
    expect(section(sample, 'First')).not.toContain('`OTHER`');
    expect(section(sample, 'Missing')).toBe('');
  });

  it('collects relative link targets without anchors, queries, code and external links', () => {
    expect(relativeLinks(sample).sort()).toEqual(
      ['../outside.md', 'docs/b.png', 'docs/guide.md', 'docs/screenshots/a.png'].sort(),
    );
  });

  it('collects srcset candidates outside code blocks without their descriptors', () => {
    const markdown = [
      `<source srcset="docs/a.svg 1x, docs/b.svg 2x"><source srcSet='docs/c.svg'>`,
      '```html',
      '<source srcset="fenced.svg">',
      '```',
    ].join('\n');
    expect(srcsetTargets(markdown)).toEqual(['docs/a.svg', 'docs/b.svg', 'docs/c.svg']);
  });

  it('resolves links relative to the linking file', () => {
    expect(exists('../compose.yaml', 'docs/deploy.md')).toBe(true);
    expect(exists('compose.yaml', 'docs/deploy.md')).toBe(false);
    expect(exists('/compose.yaml', 'README.md')).toBe(false);
  });
});

describe('svg helpers', () => {
  it('flags references that leave the file', () => {
    const svg = `<use href="#mark"/><path fill="url(#glow)"/><use xlink:href="https://example.com/a.svg#x"/><style>a{b:url('x.woff')}</style>`;
    expect(externalReferences(svg)).toEqual(['https://example.com/a.svg#x', 'x.woff']);
  });

  it('accepts a banner with a titled viewBox and outlined text only', () => {
    const svg =
      '<svg viewBox="0 0 4 4"><title id="t">Banner</title><path d="M0 0h4v4z" fill="url(#g)"/></svg>';
    expect(bannerProblems(svg)).toEqual([]);
  });

  it('reports live text, web fonts, long dashes, a missing title and a missing viewBox', () => {
    const webFont = '<svg viewBox="0 0 4 4"><title>B</title><style>@font-face{font-family:x}</style></svg>';
    expect(bannerProblems('<svg><svg:text>Banner — new</svg:text></svg>')).toEqual([
      'no viewBox',
      'no title',
      'script, foreignObject, image, text or a web font',
      'long dash',
    ]);
    expect(bannerProblems(webFont)).toEqual(['script, foreignObject, image, text or a web font']);
  });
});
