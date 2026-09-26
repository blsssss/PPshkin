import { withTransaction, type Pool } from '../db/pool.ts';
import { CONSENT_DOCUMENTS } from '../domain/consents.ts';
import type { Consent } from '../domain/models.ts';
import { CONSENT_KINDS, type ConsentChannel, type ConsentKind } from '../domain/vocabulary.ts';
import * as consents from '../repositories/consents.ts';
import type { Clock } from '../shared/clock.ts';
import { conflict, forbidden, notFound } from '../shared/errors.ts';

export interface ConsentState {
  granted: boolean;
  version: string | null;
  grantedAt: Date | null;
}

export interface ConsentStatus {
  personalData: ConsentState;
  personalizedOffers: ConsentState;
}

export interface ConsentDocumentState {
  kind: ConsentKind;
  version: string;
  title: string;
  text: string;
  required: boolean;
  granted: boolean;
  grantedAt: Date | null;
}

export interface ConsentsService {
  status(userId: number): Promise<ConsentStatus>;
  list(userId: number): Promise<ConsentDocumentState[]>;
  grant(userId: number, kind: ConsentKind, version: string, channel: ConsentChannel): Promise<ConsentState>;
  revoke(userId: number, kind: ConsentKind): Promise<void>;
  requirePersonalData(userId: number): Promise<void>;
}

export interface ConsentsDependencies {
  pool: Pool;
  clock: Clock;
}

function stateOf(kind: ConsentKind, active: readonly Consent[]): ConsentState {
  const record = active.find((consent) => consent.kind === kind);
  if (!record) return { granted: false, version: null, grantedAt: null };
  return {
    granted: record.version === CONSENT_DOCUMENTS[kind].version,
    version: record.version,
    grantedAt: record.grantedAt,
  };
}

export function createConsentsService({ pool, clock }: ConsentsDependencies): ConsentsService {
  async function status(userId: number): Promise<ConsentStatus> {
    const active = await consents.listActive(pool, userId);
    return {
      personalData: stateOf('personal_data', active),
      personalizedOffers: stateOf('personalized_offers', active),
    };
  }

  return {
    status,

    async list(userId) {
      const active = await consents.listActive(pool, userId);
      return CONSENT_KINDS.map((kind) => {
        const document = CONSENT_DOCUMENTS[kind];
        const state = stateOf(kind, active);
        return { kind, ...document, granted: state.granted, grantedAt: state.grantedAt };
      });
    },

    async grant(userId, kind, version, channel) {
      if (version !== CONSENT_DOCUMENTS[kind].version) {
        throw conflict(
          'consent_version_outdated',
          'The consent text has changed, show the current version and ask again',
        );
      }
      return withTransaction(pool, async (client) => {
        const active = await consents.listActive(client, userId);
        if (active.some((consent) => consent.kind === kind && consent.version === version)) {
          return stateOf(kind, active);
        }
        const granted = await consents.grant(client, userId, kind, version, channel, clock.now());
        if (!granted) throw notFound('user_not_found', 'User not found');
        return stateOf(kind, [granted]);
      });
    },

    async revoke(userId, kind) {
      if (CONSENT_DOCUMENTS[kind].required) {
        throw conflict(
          'delete_account_instead',
          'A required consent is withdrawn by deleting the account together with its data',
        );
      }
      await consents.revoke(pool, userId, kind, clock.now());
    },

    async requirePersonalData(userId) {
      const { personalData } = await status(userId);
      if (!personalData.granted) {
        throw forbidden('consent_required', 'Consent to personal data processing is required');
      }
    },
  };
}
