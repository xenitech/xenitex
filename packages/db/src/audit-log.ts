import { createHash } from 'node:crypto';
import type { Kysely } from 'kysely';
import { sql } from './pool.js';
import type { AuditOutcomeEnum, DB } from './generated/schema.js';

/** Fixed genesis value the very first entry's `prev_entry_hash` chains from — a real hash never coincidentally collides with 64 zeros. */
export const GENESIS_HASH = '0'.repeat(64);

/** Same fixed key on every call — this is what actually serializes concurrent appends into one total order matching the bigserial id (DATA-02). */
const AUDIT_APPEND_LOCK_KEY = 0x5845_4e49; // 'XENI' as an int, arbitrary but fixed

export interface AuditEntryInput {
  readonly actorUserId: string | null;
  readonly sessionId: string | null;
  readonly sourceAddress: string | null;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly beforeState: unknown;
  readonly afterState: unknown;
  readonly outcome: AuditOutcomeEnum;
}

function canonicalPayload(input: AuditEntryInput, occurredAt: string): Record<string, unknown> {
  // Explicit key order (not object-insertion-order-dependent, not a `JSON.stringify` of `input` directly)
  // so the exact same logical entry always canonicalizes to the exact same bytes.
  return {
    actorUserId: input.actorUserId,
    sessionId: input.sessionId,
    sourceAddress: input.sourceAddress,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    beforeState: input.beforeState,
    afterState: input.afterState,
    outcome: input.outcome,
    occurredAt,
  };
}

function computeEntryHash(canonical: Record<string, unknown>, prevEntryHash: string): string {
  return createHash('sha256').update(JSON.stringify(canonical)).update(prevEntryHash).digest('hex');
}

async function insertAuditEntry(trx: Kysely<DB>, input: AuditEntryInput): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(${AUDIT_APPEND_LOCK_KEY})`.execute(trx);

  const last = await trx
    .selectFrom('audit_entries')
    .select('entry_hash')
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
  const prevEntryHash = last?.entry_hash ?? GENESIS_HASH;

  const occurredAt = new Date().toISOString();
  const canonical = canonicalPayload(input, occurredAt);
  const entryHash = computeEntryHash(canonical, prevEntryHash);

  await trx
    .insertInto('audit_entries')
    .values({
      actor_user_id: input.actorUserId,
      session_id: input.sessionId,
      source_address: input.sourceAddress,
      action: input.action,
      target_type: input.targetType,
      target_id: input.targetId,
      before_state: input.beforeState as never,
      after_state: input.afterState as never,
      outcome: input.outcome,
      occurred_at: occurredAt,
      canonical_payload: canonical as never,
      prev_entry_hash: prevEntryHash,
      entry_hash: entryHash,
    })
    .execute();
}

/**
 * DATA-02: append-only hash chain. `pg_advisory_xact_lock` serializes
 * concurrent appends for the lock's duration — without it, two concurrent
 * transactions could both read the same "last" entry, compute hashes
 * against the same `prevEntryHash`, and insert two entries whose chain
 * silently forks. The lock is released automatically at transaction end.
 *
 * Kysely refuses `.transaction()` on an already-open `Transaction` (real
 * error: "calling the transaction method for a Transaction is not
 * supported") — callers that need the audit entry committed atomically
 * with other writes (e.g. /setup/administrator's user-row insert) pass
 * their own open transaction in, and this reuses it via `isTransaction`
 * instead of always nesting a new one.
 */
export async function appendAuditEntry(db: Kysely<DB>, input: AuditEntryInput): Promise<void> {
  if (db.isTransaction) {
    await insertAuditEntry(db, input);
    return;
  }
  await db.transaction().execute((trx) => insertAuditEntry(trx, input));
}

export interface AuditChainVerificationResult {
  readonly verifiedUpToId: number;
  readonly gapsDetected: readonly { afterId: number; expectedNextId: number }[];
  readonly hashMismatches: readonly { id: number }[];
  readonly isIntact: boolean;
}

/**
 * DATA-02: walks the chain in id order and recomputes every hash **from
 * the row's own authoritative columns** (action/target/before_state/
 * after_state/etc via `canonicalPayload`), never from the stored
 * `canonical_payload` blob itself — that column is a denormalised
 * convenience copy (matches the `AuditEntry.canonicalPayload` domain
 * field), not the trust anchor. Recomputing from `canonical_payload`
 * instead of the individual columns would miss tampering with
 * `before_state`/`after_state` directly, since those aren't reachable from
 * `canonical_payload` alone once it's been separately stored — caught by
 * `audit-log.integration.test.ts`'s tamper test.
 */
export async function verifyAuditChain(db: Kysely<DB>): Promise<AuditChainVerificationResult> {
  const rows = await db
    .selectFrom('audit_entries')
    .select([
      'id',
      'actor_user_id',
      'session_id',
      'source_address',
      'action',
      'target_type',
      'target_id',
      'before_state',
      'after_state',
      'outcome',
      'occurred_at',
      'prev_entry_hash',
      'entry_hash',
    ])
    .orderBy('id', 'asc')
    .execute();

  const gapsDetected: { afterId: number; expectedNextId: number }[] = [];
  const hashMismatches: { id: number }[] = [];
  let previousId: number | null = null;
  let expectedPrevHash = GENESIS_HASH;
  let verifiedUpToId = 0;

  for (const row of rows) {
    const id = Number(row.id);
    if (previousId !== null && id !== previousId + 1) {
      gapsDetected.push({ afterId: previousId, expectedNextId: previousId + 1 });
    }
    const canonical = canonicalPayload(
      {
        actorUserId: row.actor_user_id,
        sessionId: row.session_id,
        sourceAddress: row.source_address,
        action: row.action,
        targetType: row.target_type,
        targetId: row.target_id,
        beforeState: row.before_state,
        afterState: row.after_state,
        outcome: row.outcome,
      },
      new Date(row.occurred_at).toISOString(),
    );
    const recomputed = computeEntryHash(canonical, row.prev_entry_hash);
    const intact = recomputed === row.entry_hash && row.prev_entry_hash === expectedPrevHash;
    if (!intact) {
      hashMismatches.push({ id });
    } else {
      verifiedUpToId = id;
    }
    expectedPrevHash = row.entry_hash;
    previousId = id;
  }

  return {
    verifiedUpToId,
    gapsDetected,
    hashMismatches,
    isIntact: gapsDetected.length === 0 && hashMismatches.length === 0,
  };
}
