export interface RegistryCompany {
  kind: 'legal' | 'individual';
  inn: string;
  ogrn: string | null;
  kpp: string | null;
  name: string;
  address: string | null;
  okved: string | null;
  status: 'ACTIVE' | 'LIQUIDATING' | 'LIQUIDATED' | 'BANKRUPT' | 'REORGANIZING';
  managerName: string | null;
}

export type RegistryUnavailableReason = 'disabled' | 'timeout' | 'provider_error' | 'quota_exceeded';

export type RegistryLookup =
  | { status: 'found'; company: RegistryCompany }
  | { status: 'not_found' }
  | { status: 'unavailable'; reason: RegistryUnavailableReason };

export interface CompanyRegistry {
  findByInn(inn: string): Promise<RegistryLookup>;
}
