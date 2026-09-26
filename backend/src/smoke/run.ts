import { apiChecks } from './api.ts';
import {
  describeError,
  runCheck,
  SMOKE_GROUPS,
  SmokeFailure,
  type SmokeCheck,
  type SmokeContext,
  type SmokeDependencies,
  type SmokeGroup,
  type SmokeOptions,
  type SmokeResult,
} from './check.ts';
import { maxChecks } from './max.ts';
import { recognitionChecks } from './recognition.ts';
import { redactResults, secretRedactor } from './redact.ts';
import { siteChecks } from './site.ts';

const RUN_LIMIT_MINUTES = 12;
const RUN_LIMIT_MS = RUN_LIMIT_MINUTES * 60_000;
const OUT_OF_TIME = `the run reached its ${RUN_LIMIT_MINUTES} min limit`;

const GROUP_CHECKS: Record<SmokeGroup, (context: SmokeContext) => SmokeCheck[] | Promise<SmokeCheck[]>> = {
  max: maxChecks,
  site: siteChecks,
  recognition: recognitionChecks,
  api: apiChecks,
};

function fetchUntil({ fetch: fetchFn, clock }: SmokeDependencies, deadline: number): typeof fetch {
  return (input, init = {}) => {
    const remainingMs = deadline - clock.now().getTime();
    if (remainingMs <= 0) return Promise.reject(new SmokeFailure(OUT_OF_TIME));
    const limit = AbortSignal.timeout(remainingMs);
    return fetchFn(input, { ...init, signal: init.signal ? AbortSignal.any([init.signal, limit]) : limit });
  };
}

export async function runSmoke(options: SmokeOptions, deps: SmokeDependencies): Promise<SmokeResult[]> {
  const { env, strict } = options;
  const { clock } = deps;
  const deadline = clock.now().getTime() + RUN_LIMIT_MS;
  const context: SmokeContext = { env, deps: { ...deps, fetch: fetchUntil(deps, deadline) } };
  const results: SmokeResult[] = [];
  for (const group of SMOKE_GROUPS.filter((name) => options.checks.includes(name))) {
    let checks: SmokeCheck[];
    try {
      checks = await GROUP_CHECKS[group](context);
    } catch (error) {
      results.push({ name: group, status: 'failed', durationMs: 0, details: describeError(error) });
      continue;
    }
    for (const check of checks) {
      results.push(
        clock.now().getTime() < deadline
          ? await runCheck(check, { env, strict, clock })
          : { name: check.name, status: 'failed', durationMs: 0, details: `not started, ${OUT_OF_TIME}` },
      );
    }
  }
  return redactResults(results, secretRedactor(env));
}
