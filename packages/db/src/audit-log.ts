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

/**
 * The canonicalisation rule new entries are written under. See migration
 * 0013 — version 1 hashed over insertion-ordered JSON, which Postgres
 * `jsonb` does not preserve, so those entries cannot be re-verified.
 */
export const CURRENT_AUDIT_CHAIN_VERSION = 2;

/**
 * Deterministic JSON: object keys sorted recursively, so the serialisation
 * depends only on the VALUES, never on the order a particular code path
 * happened to build the object in.
 *
 * This is the whole fix. `JSON.stringify` emits keys in insertion order;
 * Postgres `jsonb` stores them in its own normalised order (by key length,
 * then bytewise). So `{template, formats}` was hashed on write and read
 * back as `{formats, template}` on verify — different bytes, different
 * hash, and the chain verifier called a perfectly untouched row tampered.
 * Every audit entry recording two or more fields of before/after state was
 * affected, which in practice is most of the interesting ones.
 *
 * Arrays keep their order: order is meaningful in an array and is preserved
 * faithfully by jsonb.
 */
function canonicalJson(value: unknown): string {
  // Honour `toJSON()` exactly as JSON.stringify does, BEFORE deciding this
  // is a plain object to walk.
  //
  // Without this, a `Date` anywhere in before/after state hashed as `{}` —
  // `Object.entries(someDate)` is empty, so the recursion below happily
  // serialised it as an empty object. The value that actually lands in the
  // jsonb column is the ISO string (node-postgres serialises the Date on
  // the way in), so verification read back `"2026-09-15T07:43:46.913Z"`
  // and recomputed a different hash. Same class of defect as the key
  // ordering above — write-time and read-time serialisation disagreeing —
  // and it surfaced on a real audit entry whose `beforeState` carried a
  // timestamp column straight out of a SELECT.
  if (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { toJSON?: unknown }).toJSON === 'function'
  ) {
    value = (value as { toJSON: () => unknown }).toJSON();
  }
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    // `undefined` is not representable in jsonb and would round-trip as an
    // absent key, so it is dropped here too rather than hashed as present.
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
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

function computeEntryHash(
  canonical: Record<string, unknown>,
  prevEntryHash: string,
  chainVersion: number,
): string {
  const serialised =
    chainVersion >= 2 ? canonicalJson(canonical) : (JSON.stringify(canonical) ?? 'null');
  return createHash('sha256').update(serialised).update(prevEntryHash).digest('hex');
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
  const entryHash = computeEntryHash(canonical, prevEntryHash, CURRENT_AUDIT_CHAIN_VERSION);

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
      chain_version: CURRENT_AUDIT_CHAIN_VERSION,
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
  /**
   * Entries written under chain_version 1 whose hash cannot be recomputed,
   * because that version serialised object keys in insertion order and
   * Postgres `jsonb` does not preserve it (migration 0013). These are NOT
   * evidence of tampering and must never be presented as such — but they
   * are also not verified, and saying so plainly is the point.
   */
  readonly legacyUnverifiable: readonly { id: number }[];
  /** True only when every entry the verifier CAN check, checks out. */
  readonly isIntact: boolean;
  /**
   * Separate from `isIntact` deliberately. An operator needs to be able to
   * tell "nothing has been tampered with" from "nothing has been tampered
   * with, and there is also a block of older entries I am unable to make
   * that statement about."
   */
  readonly containsUnverifiableLegacyEntries: boolean;
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
      'chain_version',
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
  const legacyUnverifiable: { id: number }[] = [];
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
    const chainVersion = Number(row.chain_version ?? 1);
    const recomputed = computeEntryHash(canonical, row.prev_entry_hash, chainVersion);
    // The linkage check applies to every entry regardless of version: a
    // deleted or reordered row breaks `prev_entry_hash` continuity no
    // matter how the payload was serialised, so version-1 entries still
    // carry real tamper-evidence for insertion and removal.
    const linkageIntact = row.prev_entry_hash === expectedPrevHash;
    const payloadIntact = recomputed === row.entry_hash;

    if (linkageIntact && payloadIntact) {
      verifiedUpToId = id;
    } else if (!linkageIntact) {
      hashMismatches.push({ id });
    } else if (chainVersion < 2) {
      // Version-1 payload hashes are not reproducible after a jsonb round
      // trip (migration 0013). Reporting these as mismatches is what made
      // the whole control unusable; they are surfaced honestly instead.
      legacyUnverifiable.push({ id });
    } else {
      hashMismatches.push({ id });
    }
    expectedPrevHash = row.entry_hash;
    previousId = id;
  }

  return {
    verifiedUpToId,
    gapsDetected,
    hashMismatches,
    legacyUnverifiable,
    isIntact: gapsDetected.length === 0 && hashMismatches.length === 0,
    containsUnverifiableLegacyEntries: legacyUnverifiable.length > 0,
  };
}
