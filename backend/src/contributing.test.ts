import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const backendDir = new URL('../', import.meta.url);
const guide = readFileSync(new URL('../CONTRIBUTING.md', backendDir), 'utf8');
const scripts = Object.keys(
  (
    JSON.parse(readFileSync(new URL('package.json', backendDir), 'utf8')) as {
      scripts: Record<string, string>;
    }
  ).scripts,
);

const mentionedPaths = [...guide.matchAll(/`((?:backend\/)?(?:src|test)\/[\w./-]+)`/g)]
  .map((match) => match[1] ?? '')
  .filter((path) => !path.includes('<') && !path.endsWith('...'))
  .map((path) => path.replace(/^backend\//, ''));

describe('CONTRIBUTING.md', () => {
  it('mentions only files and directories that exist in the backend', () => {
    expect(mentionedPaths.length).toBeGreaterThan(10);
    const missing = mentionedPaths.filter((path) => !existsSync(new URL(path, backendDir)));
    expect(missing).toEqual([]);
  });

  it('mentions only npm scripts that exist', () => {
    const mentioned = [...guide.matchAll(/npm run ([\w:-]+)/g)].map((match) => match[1] ?? '');
    expect(mentioned.length).toBeGreaterThan(3);
    expect(mentioned.filter((script) => !scripts.includes(script))).toEqual([]);
  });

  it('avoids long dash characters', () => {
    const longDashes = [String.fromCodePoint(0x2013), String.fromCodePoint(0x2014)];
    expect(longDashes.filter((dash) => guide.includes(dash))).toEqual([]);
  });
});
