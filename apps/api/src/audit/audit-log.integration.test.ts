import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { createDb, sql, type DB } from '@xenitex/db';
import type { Kysely } from 'kysely';
import { appendAuditEntry, verifyAuditChain } from './audit-log.js';

/**
 * Real Postgres only (QA-01) — requires DATABASE_URL, same convention as
 * every other integration test in this repo. `audit_entries` is append-only
 * and shared across every test run against this database (as it would be
 * in a real appliance) — this test never assumes it starts empty or
 * pristine. In particular, a *previous* run of this same test's tamper
 * step leaves a permanently-corrupted historical row behind by design
 * (that's the whole point of an append-only, tamper-evident log); this
 * test asserts against the *change* its own actions cause, not against
 * the table's total history.
 *
 * `db` is whatever DATABASE_URL points at — xenitex_app in every real
 * environment, which genuinely cannot UPDATE audit_entries (that REVOKE is
 * the actual DATA-02 defense). The deliberate tamper step below needs a
 * second, elevated connection to simulate an attacker with raw table
 * access; ADMIN_DATABASE_URL supplies that, falling back to DATABASE_URL
 * so this still runs against a bare superuser connection in contexts that
 * don't set it separately.
 */
let db: Kysely<DB>;
let adminDb: Kysely<DB>;

before(() => {
  if (!process.env.DATABASE_URL) {
    console.log('DATABASE_URL not set — skipping audit-log integration test.');
    return;
  }
  db = createDb({ connectionString: process.env.DATABASE_URL });
  adminDb = createDb({
    connectionString: process.env.ADMIN_DATABASE_URL ?? process.env.DATABASE_URL,
  });
});

after(async () => {
  await db?.destroy();
  await adminDb?.destroy();
});

test(
  'DATA-02: appended entries form a verifiable hash chain, and a tampered entry is detected',
  { skip: !process.env.DATABASE_URL },
  async () => {
    const baseline = await verifyAuditChain(db);

    // A fresh, unique target id per run keeps the entries this test cares
    // about identifiable regardless of whatever else is in the (shared,
    // real) audit log.
    const targetId = randomUUID();

    await appendAuditEntry(db, {
      actorUserId: null,
      sessionId: null,
      sourceAddress: '127.0.0.1',
      action: 'test.append_one',
      targetType: 'test',
      targetId,
      beforeState: null,
      afterState: { step: 1 },
      outcome: 'success',
    });
    await appendAuditEntry(db, {
      actorUserId: null,
      sessionId: null,
      sourceAddress: '127.0.0.1',
      action: 'test.append_two',
      targetType: 'test',
      targetId,
      beforeState: { step: 1 },
      afterState: { step: 2 },
      outcome: 'success',
    });

    const afterAppend = await verifyAuditChain(db);
    // Appending well-formed entries must never introduce a NEW mismatch or
    // gap, whatever the table's pre-existing history looked like.
    assert.equal(afterAppend.hashMismatches.length, baseline.hashMismatches.length);
    assert.equal(afterAppend.gapsDetected.length, baseline.gapsDetected.length);
    assert.ok(afterAppend.verifiedUpToId > baseline.verifiedUpToId);

    // Directly tamper with the most recent entry's stored payload, bypassing
    // the appendAuditEntry API entirely (append-only at the app layer isn't
    // enough on its own — this simulates someone with raw table access,
    // which the REVOKE UPDATE/DELETE grants in 0001_init.up.sql are the
    // real defense against; this test proves detection, not prevention).
    const [latest] = await sql<{
      id: string;
    }>`SELECT id FROM audit_entries ORDER BY id DESC LIMIT 1`
      .execute(db)
      .then((r) => r.rows);
    assert.ok(latest, 'expected at least one audit entry to tamper with');

    await sql`UPDATE audit_entries SET after_state = '{"tampered": true}'::jsonb WHERE id = ${latest.id}`.execute(
      adminDb,
    );

    const afterTamper = await verifyAuditChain(db);
    assert.equal(afterTamper.isIntact, false);
    assert.equal(
      afterTamper.hashMismatches.length,
      baseline.hashMismatches.length + 1,
      'exactly one new mismatch — the row just tampered with',
    );
    assert.ok(afterTamper.hashMismatches.some((m) => String(m.id) === String(latest.id)));
  },
);

/**
 * DATA-02 regression. The chain hash was computed over `JSON.stringify` of a
 * JavaScript object, which serialises keys in INSERTION order, but the values
 * are read back for verification out of `jsonb` columns — and Postgres `jsonb`
 * normalises key order (by key length, then bytewise). Any entry recording two
 * or more fields of before/after state therefore hashed one way on write and a
 * different way on read, and the verifier reported the untouched row as
 * TAMPERED.
 *
 * That is the worst failure mode a tamper-evidence control can have: it cried
 * wolf on roughly a quarter of real entries, so an operator following
 * docs/runbooks/appliance-suspected-compromised.md could not distinguish a
 * genuine alteration from the control's own noise. WORK-07 ranks this third in
 * what must never be cut; a control that cannot be believed is already cut.
 *
 * The keys below are chosen so that jsonb WILL reorder them — `template` (8
 * chars) sorts after `formats` (7) under jsonb's length-first rule, and
 * `alpha`/`mid`/`zeta` exercise the bytewise tiebreak — so this test fails
 * against the pre-fix implementation.
 */
test(
  'DATA-02: an entry whose state carries several keys survives the jsonb round trip',
  { skip: !process.env.DATABASE_URL },
  async () => {
    const baseline = await verifyAuditChain(db);

    for (let i = 0; i < 3; i++) {
      await appendAuditEntry(db, {
        actorUserId: null,
        sessionId: null,
        sourceAddress: '127.0.0.1',
        action: 'test.multi_key_canonicalisation',
        targetType: 'report',
        targetId: `${randomUUID()}`,
        beforeState: {
          template: 'before',
          formats: ['html', 'csv'],
          zeta: 1,
          alpha: 2,
          mid: { b: 1, a: 2 },
          // A real Date, not an ISO string. Audit entries routinely record
          // before-state read straight out of a SELECT, so timestamp
          // columns arrive here as Date objects. `Object.entries(date)` is
          // empty, so a naive recursive canonicaliser serialised them as
          // `{}` while node-postgres wrote the ISO string into jsonb —
          // another write/read disagreement, caught on a real
          // `organization_settings.updated` entry.
          capturedAt: new Date('2026-09-15T07:43:46.913Z'),
          nested: { at: new Date('2026-01-02T03:04:05.006Z') },
        },
        afterState: {
          template: 'after',
          formats: ['json'],
          zeta: 3,
          alpha: 4,
          mid: { b: 5, a: 6 },
        },
        outcome: 'success',
      });
    }

    const after = await verifyAuditChain(db);
    assert.equal(
      after.hashMismatches.length,
      baseline.hashMismatches.length,
      'appending multi-key state must not introduce a single new mismatch',
    );
    assert.equal(
      after.legacyUnverifiable.length,
      baseline.legacyUnverifiable.length,
      'newly written entries are chain_version 2 and must be fully verifiable',
    );
    assert.ok(
      after.verifiedUpToId > baseline.verifiedUpToId,
      'the new entries must be positively verified, not merely not-failed',
    );
  },
);
