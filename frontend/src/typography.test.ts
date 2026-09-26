import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE_DIR = resolve(process.cwd(), 'src');
const FORBIDDEN = [String.fromCharCode(0x2014), String.fromCharCode(0x2013)];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|css)$/.test(name) && name !== 'schema.d.ts' ? [path] : [];
  });
}

describe('typography rules', () => {
  it('has no em or en dashes in src', () => {
    const offenders = sourceFiles(SOURCE_DIR).filter((path) => {
      const text = readFileSync(path, 'utf8');
      return FORBIDDEN.some((dash) => text.includes(dash));
    });
    expect(offenders).toEqual([]);
  });
});
