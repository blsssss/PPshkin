import { maybeOne, one, type Queryable } from '../db/pool.ts';
import type { Consent } from '../domain/models.ts';
import type { ConsentChannel, ConsentKind } from '../domain/vocabulary.ts';

interface ConsentRow {
  id: number;
  user_id: number;
  kind: ConsentKind;
  version: string;
  channel: ConsentChannel;
  granted_at: Date;
  revoked_at: Date | null;
}

const CONSENT_COLUMNS = 'id, user_id, kind, version, channel, granted_at, revoked_at';

function mapConsent(row: ConsentRow): Consent {
  return {
    id: row.id,
    userId: row.user_id,
    kind: row.kind,
    version: row.version,
    channel: row.channel,
    grantedAt: row.granted_at,
    revokedAt: row.revoked_at,
  };
}

export async function grant(
  db: Queryable,
  userId: number,
  kind: ConsentKind,
  version: string,
  channel: ConsentChannel,
  at: Date,
): Promise<Consent | null> {
  const owner = await maybeOne(db, 'select id from users where id = $1 for update', [userId]);
  if (!owner) return null;
  const active = await maybeOne<ConsentRow>(
    db,
    `select ${CONSENT_COLUMNS} from consents
      where user_id = $1 and kind = $2 and revoked_at is null`,
    [userId, kind],
  );
  if (active?.version === version) return mapConsent(active);
  await revoke(db, userId, kind, at);
  const row = await one<ConsentRow>(
    db,
    `insert into consents (user_id, kind, version, channel, granted_at)
     values ($1, $2, $3, $4, $5)
     returning ${CONSENT_COLUMNS}`,
    [userId, kind, version, channel, at],
  );
  return mapConsent(row);
}

export async function revoke(db: Queryable, userId: number, kind: ConsentKind, at: Date): Promise<boolean> {
  const { rowCount } = await db.query(
    `update consents set revoked_at = $3
      where user_id = $1 and kind = $2 and revoked_at is null`,
    [userId, kind, at],
  );
  return rowCount === 1;
}

export async function listActive(db: Queryable, userId: number): Promise<Consent[]> {
  const { rows } = await db.query<ConsentRow>(
    `select ${CONSENT_COLUMNS} from consents
      where user_id = $1 and revoked_at is null
      order by kind`,
    [userId],
  );
  return rows.map(mapConsent);
}
