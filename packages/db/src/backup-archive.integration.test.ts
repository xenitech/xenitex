import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createDb, sql, BACKUP_TABLE_ORDER, EXCLUDED_TABLES, type DB } from './index.js';
import type { Kysely } from 'kysely';

const RUN = Boolean(process.env.DATABASE_URL);

let db: Kysely<DB>;

before(() => {
  if (!RUN) return;
  db = createDb({ connectionString: process.env.DATABASE_URL! });
});

after(async () => {
  if (!RUN) return;
  await db.destroy();
});

/**
 * DATA-05. A table that exists in the schema but appears in neither
 * `BACKUP_TABLE_ORDER` nor `EXCLUDED_TABLES` is silently absent from every
 * backup — and nobody finds out until a restore, which is the worst
 * possible moment.
 *
 * This is not hypothetical. Five tables (`intel_settings`,
 * `identity_resolution_policies`, `false_positive_reasons`,
 * `remediation_guidance`, `asset_merge_events`) were missing from the first
 * version of that list, and the omission surfaced as a foreign-key
 * violation partway through a restore: `intel_settings.updated_by`
 * referenced a `users` row the restore was trying to delete. The restore
 * rolled back correctly, but a backup that cannot be restored is not a
 * backup.
 *
 * Forcing every table into one list or the other means adding a table is a
 * deliberate decision about whether it belongs in a backup, rather than a
 * silent default.
 */
test(
  'every table is either backed up or explicitly excluded (DATA-05)',
  { skip: !RUN },
  async () => {
    const result = await sql<{ tablename: string }>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `.execute(db);

    const actual = new Set(result.rows.map((r) => r.tablename));
    const listed = new Set(BACKUP_TABLE_ORDER);
    const excluded = new Set(Object.keys(EXCLUDED_TABLES));

    const unaccounted = [...actual].filter((t) => !listed.has(t) && !excluded.has(t)).sort();
    assert.deepEqual(
      unaccounted,
      [],
      `These tables exist but are neither backed up nor explicitly excluded:\n  ${unaccounted.join('\n  ')}\n` +
        'Add each to BACKUP_TABLE_ORDER (in an order that satisfies its foreign keys) or to ' +
        'EXCLUDED_TABLES with the reason it must not be restored.',
    );

    const phantom = [...listed].filter((t) => !actual.has(t)).sort();
    assert.deepEqual(
      phantom,
      [],
      `BACKUP_TABLE_ORDER names tables that do not exist: ${phantom.join(', ')}`,
    );
  },
);

/**
 * The order is what makes a restore possible at all: rows are inserted
 * forwards and deleted backwards, so a table must appear AFTER everything
 * it references. Checking it against the live foreign-key graph catches a
 * mis-ordered insertion before it becomes a failed restore.
 */
test('BACKUP_TABLE_ORDER satisfies the foreign-key graph', { skip: !RUN }, async () => {
  const result = await sql<{ child: string; parent: string }>`
    SELECT c.conrelid::regclass::text AS child,
           c.confrelid::regclass::text AS parent
    FROM pg_constraint c
    JOIN pg_class ch ON ch.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = ch.relnamespace
    WHERE c.contype = 'f' AND n.nspname = 'public'
  `.execute(db);

  /**
   * The two deliberate cycles the schema contains. No table ordering can
   * satisfy a cycle, so migration 0016 makes exactly these two constraints
   * DEFERRABLE and the restore defers them to COMMIT. They are listed here
   * explicitly so a THIRD cycle — which would break restore again — still
   * fails this test instead of being absorbed silently.
   */
  const KNOWN_DEFERRED_CYCLES = new Set([
    'issues -> exceptions',
    'asset_identity_keys -> observations',
  ]);

  const position = new Map(BACKUP_TABLE_ORDER.map((table, index) => [table, index]));
  const excluded = new Set(Object.keys(EXCLUDED_TABLES));
  const violations: string[] = [];

  for (const { child, parent } of result.rows) {
    // A self-reference (e.g. vulnerability_data_imports.superseded_by_id)
    // is resolved within a single insert, not across tables.
    if (child === parent) continue;
    if (excluded.has(child) || excluded.has(parent)) continue;
    const childIndex = position.get(child);
    const parentIndex = position.get(parent);
    if (childIndex === undefined || parentIndex === undefined) continue;
    if (parentIndex > childIndex && !KNOWN_DEFERRED_CYCLES.has(`${child} -> ${parent}`)) {
      violations.push(`${child} (#${childIndex}) references ${parent} (#${parentIndex})`);
    }
  }

  assert.deepEqual(
    violations,
    [],
    `BACKUP_TABLE_ORDER inserts these before the rows they reference:\n  ${violations.join('\n  ')}`,
  );
});
