import { z } from 'zod';
import type {
  CompanyRegistry,
  RegistryCompany,
  RegistryLookup,
  RegistryUnavailableReason,
} from '../../ports/company-registry.ts';

export const DADATA_FIND_PARTY_URL = 'https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party';
export const DADATA_TIMEOUT_MS = 5000;

export interface DadataLogger {
  warn(object: Record<string, unknown>, message: string): void;
}

export interface DadataRegistryOptions {
  apiKey: string | null;
  fetch?: typeof fetch;
  logger?: DadataLogger;
  timeoutMs?: number;
}

const STATUSES = ['ACTIVE', 'LIQUIDATING', 'LIQUIDATED', 'BANKRUPT', 'REORGANIZING'] as const;

const SuggestionSchema = z.object({
  value: z.string(),
  data: z.object({
    type: z.enum(['LEGAL', 'INDIVIDUAL']),
    inn: z.string().nullish(),
    ogrn: z.string().nullish(),
    kpp: z.string().nullish(),
    okved: z.string().nullish(),
    address: z.object({ value: z.string().nullish() }).nullish(),
    state: z.object({ status: z.string().nullish() }).nullish(),
    management: z.object({ name: z.string().nullish() }).nullish(),
  }),
});

const ResponseSchema = z.object({ suggestions: z.array(z.unknown()) });

function unavailable(reason: RegistryUnavailableReason): RegistryLookup {
  return { status: 'unavailable', reason };
}

function statusOf(value: string | null | undefined): RegistryCompany['status'] | null {
  return STATUSES.find((status) => status === value) ?? null;
}

function toCompany(inn: string, suggestion: z.infer<typeof SuggestionSchema>): RegistryCompany | null {
  const { data } = suggestion;
  const status = statusOf(data.state?.status);
  if (status === null) return null;
  return {
    kind: data.type === 'LEGAL' ? 'legal' : 'individual',
    inn,
    ogrn: data.ogrn ?? null,
    kpp: data.kpp ?? null,
    name: suggestion.value,
    address: data.address?.value ?? null,
    okved: data.okved ?? null,
    status,
    managerName: data.management?.name ?? null,
  };
}

function failureReason(status: number): RegistryUnavailableReason {
  return status === 429 ? 'quota_exceeded' : 'provider_error';
}

export function createDadataRegistry({
  apiKey,
  fetch: fetchImpl = fetch,
  logger,
  timeoutMs = DADATA_TIMEOUT_MS,
}: DadataRegistryOptions): CompanyRegistry {
  return {
    async findByInn(inn) {
      if (apiKey === null) return unavailable('disabled');
      let response: Response;
      try {
        response = await fetchImpl(DADATA_FIND_PARTY_URL, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            authorization: `Token ${apiKey}`,
          },
          body: JSON.stringify({ query: inn, branch_type: 'MAIN', count: 1 }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        const timedOut =
          error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
        logger?.warn({ reason: timedOut ? 'timeout' : 'network' }, 'DaData request failed');
        return unavailable(timedOut ? 'timeout' : 'provider_error');
      }
      if (!response.ok) {
        logger?.warn({ status: response.status }, 'DaData answered with an error');
        return unavailable(failureReason(response.status));
      }
      const body = ResponseSchema.safeParse(await response.json().catch(() => null));
      if (!body.success) {
        logger?.warn({}, 'DaData answered with an unexpected body');
        return unavailable('provider_error');
      }
      const [first] = body.data.suggestions;
      if (first === undefined) return { status: 'not_found' };
      const suggestion = SuggestionSchema.safeParse(first);
      const company = suggestion.success ? toCompany(inn, suggestion.data) : null;
      if (company === null) {
        logger?.warn({}, 'DaData answered with an unexpected company');
        return unavailable('provider_error');
      }
      return { status: 'found', company };
    },
  };
}
