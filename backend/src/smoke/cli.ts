import { parseArgs } from 'node:util';
import {
  SMOKE_GROUPS,
  type SmokeDependencies,
  type SmokeEnv,
  type SmokeGroup,
  type SmokeOptions,
} from './check.ts';
import { secretRedactor } from './redact.ts';
import { renderReport } from './report.ts';
import { runSmoke } from './run.ts';

const ALL = 'all';
const USAGE = `usage: npm run smoke -- [--checks ${ALL}|${SMOKE_GROUPS.join(',')}] [--strict]`;
const USAGE_EXIT_CODE = 2;

interface TextOutput {
  write(text: string): unknown;
}

export interface SmokeCliDependencies extends SmokeDependencies {
  appendFile: (path: string, text: string) => Promise<void>;
  stdout: TextOutput;
  stderr: TextOutput;
}

const isGroup = (name: string): name is SmokeGroup => (SMOKE_GROUPS as readonly string[]).includes(name);

function parseGroups(list: string): SmokeGroup[] {
  const names = list
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  if (names.length === 0) {
    throw new Error(`--checks needs ${ALL} or a comma list of ${SMOKE_GROUPS.join(', ')}`);
  }
  const unknown = names.filter((name) => name !== ALL && !isGroup(name));
  if (unknown.length > 0) {
    throw new Error(`unknown checks: ${unknown.join(', ')}; expected ${ALL} or ${SMOKE_GROUPS.join(', ')}`);
  }
  return names.includes(ALL) ? [...SMOKE_GROUPS] : SMOKE_GROUPS.filter((group) => names.includes(group));
}

export function parseSmokeArgs(argv: readonly string[]): Pick<SmokeOptions, 'checks' | 'strict'> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      checks: { type: 'string', default: ALL },
      strict: { type: 'boolean', default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  return { checks: parseGroups(values.checks), strict: values.strict };
}

export async function runSmokeCli(
  argv: readonly string[],
  env: SmokeEnv,
  deps: SmokeCliDependencies,
): Promise<number> {
  let args: Pick<SmokeOptions, 'checks' | 'strict'>;
  try {
    args = parseSmokeArgs(argv);
  } catch (error) {
    deps.stderr.write(
      `${secretRedactor(env)(error instanceof Error ? error.message : String(error))}\n${USAGE}\n`,
    );
    return USAGE_EXIT_CODE;
  }
  const results = await runSmoke({ ...args, env }, deps);
  const report = renderReport(results);
  deps.stdout.write(report);
  const summaryFile = env.GITHUB_STEP_SUMMARY;
  if (summaryFile) await deps.appendFile(summaryFile, report);
  return results.some((result) => result.status === 'failed') ? 1 : 0;
}
