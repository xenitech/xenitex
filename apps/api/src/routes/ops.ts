import type { FastifyInstance } from 'fastify';
import { newId } from '@xenitex/domain';
import type { ApiDependencies } from '../dependencies.js';
import { appendAuditEntry } from '../audit/audit-log.js';
import { verifyAuditChain } from '../audit/audit-log.js';
import { requireRole } from '../auth/capabilities.js';
import { problem, requireSession, sourceAddressOf } from './auth.js';
import { encodeCursor, decodeCursor, parseLimit } from '../lib/pagination.js';
import { getIdempotentResponse, storeIdempotentResponse } from '../lib/idempotency.js';
import { etagFor } from '../lib/etag.js';

// size_bytes is bigint -> Kysely's Int8 (string-typed for precision
// safety); the contract requires a real integer or null. A backup archive
// is nowhere near Number.MAX_SAFE_INTEGER, so this conversion is safe.
function toNullableNumber(value: string | number | null): number | null {
  return value === null ? null : Number(value);
}

async function requireAdministrator(db: ApiDependencies['db'], userId: string): Promise<boolean> {
  const user = await db
    .selectFrom('users')
    .select('role')
    .where('id', '=', userId)
    .executeTakeFirstOrThrow();
  return requireRole(user.role, 'administrator');
}

async function requireOperator(db: ApiDependencies['db'], userId: string): Promise<boolean> {
  const user = await db
    .selectFrom('users')
    .select('role')
    .where('id', '=', userId)
    .executeTakeFirstOrThrow();
  return requireRole(user.role, 'operator');
}

function toAuditEntry(row: {
  id: string | number;
  actor_user_id: string | null;
  session_id: string | null;
  source_address: unknown;
  action: string;
  target_type: string;
  target_id: string;
  before_state: unknown;
  after_state: unknown;
  outcome: string;
  occurred_at: Date | string;
  prev_entry_hash: string;
  entry_hash: string;
}) {
  return {
    id: Number(row.id),
    actorUserId: row.actor_user_id,
    sessionId: row.session_id,
    sourceAddress: row.source_address,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    beforeState: row.before_state,
    afterState: row.after_state,
    outcome: row.outcome,
    occurredAt: row.occurred_at,
    prevEntryHash: row.prev_entry_hash,
    entryHash: row.entry_hash,
  };
}

function toNotificationChannel(row: {
  id: string;
  type: string;
  config: unknown;
  secret_ref: string | null;
  is_enabled: boolean;
}) {
  return {
    id: row.id,
    type: row.type,
    config: row.config,
    secretRef: row.secret_ref,
    isEnabled: row.is_enabled,
  };
}

function csvEscape(value: unknown): string {
  const str = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

export async function registerOpsRoutes(
  app: FastifyInstance,
  deps: ApiDependencies,
): Promise<void> {
  const { db } = deps;

  // ------------------------------------------------------------ GlobalStop
  app.post('/global-stop', { preHandler: requireSession(deps) }, async (request, reply) => {
    const currentUser = request.currentUser!;
    if (!(await requireOperator(db, currentUser.userId))) {
      return reply
        .code(403)
        .type('application/problem+json')
        .send(problem(403, 'auth.forbidden', 'Operator role required'));
    }
    const body = request.body as { reason?: string } | undefined;

    // One transaction: a stop that aborted the runs but then failed before
    // recording the event would leave an unexplained mass abort in the
    // history with nobody's name on it.
    const { haltedIds, disabledScheduleIds, eventId } = await db
      .transaction()
      .execute(async (trx) => {
        const haltedRuns = await trx
          .updateTable('scan_runs')
          .set({
            status: 'aborted',
            aborted_by_user_id: currentUser.userId,
            aborted_reason: body?.reason ?? 'Global stop invoked',
          })
          .where('status', 'in', ['queued', 'running', 'paused'])
          .returning('id')
          .execute();

        // SAFE-07 requires halting "all queued and running scan activity".
        // Aborting the current runs alone is not that: a schedule firing a
        // minute later starts a new one, and the operator who just hit the
        // emergency stop watches scanning restart by itself. Schedules are
        // disabled, not deleted, and are re-enabled deliberately.
        const disabledSchedules = await trx
          .updateTable('scan_schedules')
          .set({ is_enabled: false })
          .where('is_enabled', '=', true)
          .returning('id')
          .execute();

        const id = newId();
        await trx
          .insertInto('global_stop_events')
          .values({
            id,
            invoked_by_user_id: currentUser.userId,
            invoked_via: 'web',
            reason: body?.reason ?? null,
            scan_runs_halted: haltedRuns.map((r) => r.id),
          })
          .execute();

        return {
          haltedIds: haltedRuns.map((r) => r.id),
          disabledScheduleIds: disabledSchedules.map((r) => r.id),
          eventId: id,
        };
      });
    await appendAuditEntry(db, {
      actorUserId: currentUser.userId,
      sessionId: currentUser.sessionId,
      sourceAddress: sourceAddressOf(request),
      action: 'global_stop.invoked',
      targetType: 'global_stop_event',
      targetId: eventId,
      beforeState: null,
      afterState: {
        scanRunsHalted: haltedIds,
        schedulesDisabled: disabledScheduleIds,
        reason: body?.reason ?? null,
      },
      outcome: 'success',
    });

    const event = await db
      .selectFrom('global_stop_events')
      .selectAll()
      .where('id', '=', eventId)
      .executeTakeFirstOrThrow();
    return reply.code(200).send({
      id: event.id,
      invokedByUserId: event.invoked_by_user_id,
      invokedVia: event.invoked_via,
      invokedAt: event.invoked_at,
      reason: event.reason,
      scanRunsHalted: event.scan_runs_halted,
      schedulesDisabled: disabledScheduleIds,
    });
  });

  app.get('/global-stop/history', { preHandler: requireSession(deps) }, async (request, reply) => {
    const query = request.query as { cursor?: string; limit?: string };
    const limit = parseLimit(query.limit);
    const cursorId = query.cursor ? decodeCursor(query.cursor) : null;

    let q = db
      .selectFrom('global_stop_events')
      .selectAll()
      .orderBy('id', 'asc')
      .limit(limit + 1);
    if (cursorId) q = q.where('id', '>', cursorId);
    const rows = await q.execute();
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    return reply.code(200).send({
      items: pageRows.map((event) => ({
        id: event.id,
        invokedByUserId: event.invoked_by_user_id,
        invokedVia: event.invoked_via,
        invokedAt: event.invoked_at,
        reason: event.reason,
        scanRunsHalted: event.scan_runs_halted,
      })),
      nextCursor: hasMore ? encodeCursor(pageRows.at(-1)!.id) : null,
    });
  });

  // --------------------------------------------------------------- Audit
  app.get('/audit-entries', { preHandler: requireSession(deps) }, async (request, reply) => {
    const currentUser = request.currentUser!;
    if (!(await requireAdministrator(db, currentUser.userId))) {
      return reply
        .code(403)
        .type('application/problem+json')
        .send(problem(403, 'auth.forbidden', 'Administrator role required'));
    }
    const query = request.query as {
      cursor?: string;
      limit?: string;
      actorUserId?: string;
      targetType?: string;
      from?: string;
      to?: string;
    };
    const limit = parseLimit(query.limit);
    const cursorId = query.cursor ? decodeCursor(query.cursor) : null;

    let q = db
      .selectFrom('audit_entries')
      .selectAll()
      .orderBy('id', 'asc')
      .limit(limit + 1);
    if (cursorId) q = q.where('id', '>', cursorId);
    if (query.actorUserId) q = q.where('actor_user_id', '=', query.actorUserId);
    if (query.targetType) q = q.where('target_type', '=', query.targetType);
    if (query.from) q = q.where('occurred_at', '>=', new Date(query.from));
    if (query.to) q = q.where('occurred_at', '<=', new Date(query.to));
    const rows = await q.execute();
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    return reply.code(200).send({
      items: pageRows.map(toAuditEntry),
      nextCursor: hasMore ? encodeCursor(String(pageRows.at(-1)!.id)) : null,
    });
  });

  app.get('/audit-entries/export', { preHandler: requireSession(deps) }, async (request, reply) => {
    const currentUser = request.currentUser!;
    if (!(await requireAdministrator(db, currentUser.userId))) {
      return reply
        .code(403)
        .type('application/problem+json')
        .send(problem(403, 'auth.forbidden', 'Administrator role required'));
    }
    const query = request.query as { from?: string; to?: string };
    let q = db.selectFrom('audit_entries').selectAll().orderBy('id', 'asc');
    if (query.from) q = q.where('occurred_at', '>=', new Date(query.from));
    if (query.to) q = q.where('occurred_at', '<=', new Date(query.to));
    const rows = await q.execute();

    const header = [
      'id',
      'actorUserId',
      'sourceAddress',
      'action',
      'targetType',
      'targetId',
      'outcome',
      'occurredAt',
      'entryHash',
    ];
    const lines = [header.join(',')];
    for (const row of rows) {
      lines.push(
        [
          row.id,
          row.actor_user_id,
          row.source_address,
          row.action,
          row.target_type,
          row.target_id,
          row.outcome,
          new Date(row.occurred_at).toISOString(),
          row.entry_hash,
        ]
          .map(csvEscape)
          .join(','),
      );
    }
    await appendAuditEntry(db, {
      actorUserId: currentUser.userId,
      sessionId: currentUser.sessionId,
      sourceAddress: sourceAddressOf(request),
      action: 'audit.exported',
      targetType: 'audit_entries',
      targetId: 'export',
      beforeState: null,
      afterState: { rowCount: rows.length },
      outcome: 'success',
    });
    return reply.code(200).type('text/csv').send(lines.join('\n'));
  });

  app.get('/audit-chain/verify', { preHandler: requireSession(deps) }, async (request, reply) => {
    if (!(await requireAdministrator(db, request.currentUser!.userId))) {
      return reply
        .code(403)
        .type('application/problem+json')
        .send(problem(403, 'auth.forbidden', 'Administrator role required'));
    }
    const result = await verifyAuditChain(db);
    return reply.code(200).send(result);
  });

  // ---------------------------------------------------------- SystemHealth
  app.get('/system-health', { preHandler: requireSession(deps) }, async (_request, reply) => {
    const [dbCheck, redisCheck, importRow, backupRow, queueDepth] = await Promise.all([
      db
        .selectFrom('users')
        .select((eb) => eb.fn.countAll().as('count'))
        .executeTakeFirst()
        .then(() => 'ok' as const)
        .catch(() => 'down' as const),
      deps.redis
        .ping()
        .then(() => 'ok' as const)
        .catch(() => 'down' as const),
      db
        .selectFrom('vulnerability_data_imports')
        .select('imported_at')
        .where('status', '=', 'applied')
        .orderBy('imported_at', 'desc')
        .limit(1)
        .executeTakeFirst(),
      db
        .selectFrom('backup_records')
        .select('completed_at')
        .where('status', '=', 'completed')
        .orderBy('completed_at', 'desc')
        .limit(1)
        .executeTakeFirst(),
      db
        .selectFrom('scan_runs')
        .select((eb) => eb.fn.countAll().as('count'))
        .where('status', 'in', ['queued', 'running'])
        .executeTakeFirstOrThrow(),
    ]);

    const vulnerabilityDataAgeDays = importRow
      ? (Date.now() - new Date(importRow.imported_at).getTime()) / 86_400_000
      : Number.POSITIVE_INFINITY;

    const components = [
      { name: 'database', status: dbCheck },
      { name: 'redis', status: redisCheck },
    ] as const;
    const degradedSubsystems = components.filter((c) => c.status !== 'ok').map((c) => c.name);

    return reply.code(200).send({
      components,
      vulnerabilityDataAgeDays,
      diskHeadroomBytes: 0,
      diskHeadroomProjectionDays: null,
      lastSuccessfulBackupAt: backupRow?.completed_at ?? null,
      queueBacklog: Number(queueDepth.count),
      degradedSubsystems,
    });
  });

  // ------------------------------------------------------- RetentionPolicy
  app.get('/retention-policies', { preHandler: requireSession(deps) }, async (_request, reply) => {
    const rows = await db.selectFrom('retention_policies').selectAll().execute();
    return reply.code(200).send(
      rows.map((row) => ({
        dataClass: row.data_class,
        retentionDays: row.retention_days,
        minimumFloorDays: row.minimum_floor_days,
      })),
    );
  });

  app.get(
    '/retention-policies/:dataClass',
    { preHandler: requireSession(deps) },
    async (request, reply) => {
      const { dataClass } = request.params as { dataClass: string };
      const row = await db
        .selectFrom('retention_policies')
        .selectAll()
        .where('data_class', '=', dataClass as never)
        .executeTakeFirst();
      if (!row) {
        return reply
          .code(404)
          .type('application/problem+json')
          .send(problem(404, 'resource.not_found', 'Retention policy not found'));
      }
      return reply
        .code(200)
        .header(
          'ETag',
          etagFor({
            dataClass: row.data_class,
            retentionDays: row.retention_days,
            minimumFloorDays: row.minimum_floor_days,
          }),
        )
        .send({
          dataClass: row.data_class,
          retentionDays: row.retention_days,
          minimumFloorDays: row.minimum_floor_days,
        });
    },
  );

  app.patch(
    '/retention-policies/:dataClass',
    { preHandler: requireSession(deps) },
    async (request, reply) => {
      const currentUser = request.currentUser!;
      if (!(await requireAdministrator(db, currentUser.userId))) {
        return reply
          .code(403)
          .type('application/problem+json')
          .send(problem(403, 'auth.forbidden', 'Administrator role required'));
      }
      const { dataClass } = request.params as { dataClass: string };
      const existing = await db
        .selectFrom('retention_policies')
        .selectAll()
        .where('data_class', '=', dataClass as never)
        .executeTakeFirst();
      if (!existing) {
        return reply
          .code(404)
          .type('application/problem+json')
          .send(problem(404, 'resource.not_found', 'Retention policy not found'));
      }
      const ifMatch = request.headers['if-match'] as string | undefined;
      const currentEtag = etagFor({
        dataClass: existing.data_class,
        retentionDays: existing.retention_days,
        minimumFloorDays: existing.minimum_floor_days,
      });
      if (!ifMatch || ifMatch !== currentEtag) {
        return reply
          .code(409)
          .type('application/problem+json')
          .send(
            problem(
              409,
              'concurrency.stale_resource',
              'If-Match does not match the current resource',
            ),
          );
      }
      const body = request.body as { retentionDays?: number };
      if (typeof body?.retentionDays !== 'number') {
        return reply
          .code(400)
          .type('application/problem+json')
          .send(problem(400, 'validation.schema_violation', 'retentionDays is required'));
      }
      // DATA-04: the UI must not be able to go below the documented floor --
      // enforced here too (`retention_respects_floor`), not just client-side.
      if (body.retentionDays < existing.minimum_floor_days) {
        return reply
          .code(400)
          .type('application/problem+json')
          .send(
            problem(
              400,
              'validation.below_retention_floor',
              `retentionDays cannot be below the minimum floor of ${existing.minimum_floor_days}`,
            ),
          );
      }
      await db
        .updateTable('retention_policies')
        .set({
          retention_days: body.retentionDays,
          updated_by: currentUser.userId,
          updated_at: new Date(),
        })
        .where('data_class', '=', dataClass as never)
        .execute();
      await appendAuditEntry(db, {
        actorUserId: currentUser.userId,
        sessionId: currentUser.sessionId,
        sourceAddress: sourceAddressOf(request),
        action: 'retention_policy.updated',
        targetType: 'retention_policy',
        targetId: dataClass,
        beforeState: { retentionDays: existing.retention_days },
        afterState: { retentionDays: body.retentionDays },
        outcome: 'success',
      });
      const updated = await db
        .selectFrom('retention_policies')
        .selectAll()
        .where('data_class', '=', dataClass as never)
        .executeTakeFirstOrThrow();
      return reply
        .code(200)
        .header(
          'ETag',
          etagFor({
            dataClass: updated.data_class,
            retentionDays: updated.retention_days,
            minimumFloorDays: updated.minimum_floor_days,
          }),
        )
        .send({
          dataClass: updated.data_class,
          retentionDays: updated.retention_days,
          minimumFloorDays: updated.minimum_floor_days,
        });
    },
  );

  // --------------------------------------------------------- BackupRecords
  app.get('/backup-records', { preHandler: requireSession(deps) }, async (request, reply) => {
    if (!(await requireAdministrator(db, request.currentUser!.userId))) {
      return reply
        .code(403)
        .type('application/problem+json')
        .send(problem(403, 'auth.forbidden', 'Administrator role required'));
    }
    const query = request.query as { cursor?: string; limit?: string };
    const limit = parseLimit(query.limit);
    const cursorId = query.cursor ? decodeCursor(query.cursor) : null;

    let q = db
      .selectFrom('backup_records')
      .selectAll()
      .orderBy('id', 'asc')
      .limit(limit + 1);
    if (cursorId) q = q.where('id', '>', cursorId);
    const rows = await q.execute();
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    return reply.code(200).send({
      items: pageRows.map((row) => ({
        id: row.id,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        status: row.status,
        archiveLocation: row.archive_location,
        sizeBytes: toNullableNumber(row.size_bytes),
        encrypted: row.encrypted,
        restoreTestedAt: row.restore_tested_at,
        measuredRpoSeconds: row.measured_rpo_seconds,
        measuredRtoSeconds: row.measured_rto_seconds,
      })),
      nextCursor: hasMore ? encodeCursor(pageRows.at(-1)!.id) : null,
    });
  });

  app.get(
    '/backup-records/:backupId',
    { preHandler: requireSession(deps) },
    async (request, reply) => {
      if (!(await requireAdministrator(db, request.currentUser!.userId))) {
        return reply
          .code(403)
          .type('application/problem+json')
          .send(problem(403, 'auth.forbidden', 'Administrator role required'));
      }
      const { backupId } = request.params as { backupId: string };
      const row = await db
        .selectFrom('backup_records')
        .selectAll()
        .where('id', '=', backupId)
        .executeTakeFirst();
      if (!row) {
        return reply
          .code(404)
          .type('application/problem+json')
          .send(problem(404, 'resource.not_found', 'Backup record not found'));
      }
      return reply.code(200).send({
        id: row.id,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        status: row.status,
        archiveLocation: row.archive_location,
        sizeBytes: toNullableNumber(row.size_bytes),
        encrypted: row.encrypted,
        restoreTestedAt: row.restore_tested_at,
        measuredRpoSeconds: row.measured_rpo_seconds,
        measuredRtoSeconds: row.measured_rto_seconds,
      });
    },
  );

  app.post('/backups', { preHandler: requireSession(deps) }, async (request, reply) => {
    const currentUser = request.currentUser!;
    if (!(await requireAdministrator(db, currentUser.userId))) {
      return reply
        .code(403)
        .type('application/problem+json')
        .send(problem(403, 'auth.forbidden', 'Administrator role required'));
    }
    const idempotencyKey = request.headers['idempotency-key'] as string | undefined;
    if (!idempotencyKey) {
      return reply
        .code(400)
        .type('application/problem+json')
        .send(problem(400, 'validation.schema_violation', 'Idempotency-Key header is required'));
    }
    const cached = await getIdempotentResponse(deps.redis, 'createBackup', idempotencyKey);
    if (cached) return reply.code(cached.status).send(cached.body);

    // DATA-05 requires one consistent encrypted archive of database + blob
    // store + configuration, with restore exercised and RPO/RTO measured in
    // CI. That real archival/encryption/restore pipeline does not exist yet
    // -- this endpoint is deliberately honest about that rather than
    // silently faking success: it records a 'failed' attempt with the real
    // reason, instead of writing a BackupRecord that claims a backup
    // completed when nothing was actually archived anywhere.
    const backupId = newId();
    await db
      .insertInto('backup_records')
      .values({
        id: backupId,
        started_at: new Date(),
        completed_at: new Date(),
        status: 'failed',
        archive_location: '',
        encrypted: true,
      })
      .execute();
    const record = await db
      .selectFrom('backup_records')
      .selectAll()
      .where('id', '=', backupId)
      .executeTakeFirstOrThrow();
    const responseBody = {
      id: record.id,
      startedAt: record.started_at,
      completedAt: record.completed_at,
      status: record.status,
      archiveLocation: record.archive_location,
      sizeBytes: toNullableNumber(record.size_bytes),
      encrypted: record.encrypted,
      restoreTestedAt: record.restore_tested_at,
      measuredRpoSeconds: record.measured_rpo_seconds,
      measuredRtoSeconds: record.measured_rto_seconds,
    };
    await storeIdempotentResponse(deps.redis, 'createBackup', idempotencyKey, {
      status: 202,
      body: responseBody,
    });
    return reply.code(202).send(responseBody);
  });

  // ---------------------------------------------------- NotificationChannels
  app.get(
    '/notification-channels',
    { preHandler: requireSession(deps) },
    async (request, reply) => {
      if (!(await requireOperator(db, request.currentUser!.userId))) {
        return reply
          .code(403)
          .type('application/problem+json')
          .send(problem(403, 'auth.forbidden', 'Operator role required'));
      }
      const rows = await db
        .selectFrom('notification_channels')
        .selectAll()
        .orderBy('created_at', 'asc')
        .execute();
      return reply.code(200).send(rows.map(toNotificationChannel));
    },
  );

  app.post(
    '/notification-channels',
    { preHandler: requireSession(deps) },
    async (request, reply) => {
      const currentUser = request.currentUser!;
      // capabilities.ts's notifications.write is operator+ -- an operator
      // whose UI shows this control based on that capability payload must
      // not then get a 403 here; SEC-13 makes this the real check, but it
      // has to agree with the cosmetic one apps/web renders against.
      if (!(await requireOperator(db, currentUser.userId))) {
        return reply
          .code(403)
          .type('application/problem+json')
          .send(problem(403, 'auth.forbidden', 'Operator role required'));
      }
      const idempotencyKey = request.headers['idempotency-key'] as string | undefined;
      if (!idempotencyKey) {
        return reply
          .code(400)
          .type('application/problem+json')
          .send(problem(400, 'validation.schema_violation', 'Idempotency-Key header is required'));
      }
      const cached = await getIdempotentResponse(
        deps.redis,
        'createNotificationChannel',
        idempotencyKey,
      );
      if (cached) return reply.code(cached.status).send(cached.body);

      const body = request.body as {
        type?: string;
        config?: Record<string, unknown>;
        secretRef?: string | null;
        isEnabled?: boolean;
      };
      if (!body?.type || !body.config) {
        return reply
          .code(400)
          .type('application/problem+json')
          .send(problem(400, 'validation.schema_violation', 'type and config are required'));
      }
      const channelId = newId();
      await db
        .insertInto('notification_channels')
        .values({
          id: channelId,
          type: body.type as never,
          config: body.config as never,
          secret_ref: body.secretRef ?? null,
          is_enabled: body.isEnabled ?? true,
          created_by: currentUser.userId,
        })
        .execute();
      await appendAuditEntry(db, {
        actorUserId: currentUser.userId,
        sessionId: currentUser.sessionId,
        sourceAddress: sourceAddressOf(request),
        action: 'notification_channel.created',
        targetType: 'notification_channel',
        targetId: channelId,
        beforeState: null,
        afterState: { type: body.type },
        outcome: 'success',
      });
      const row = await db
        .selectFrom('notification_channels')
        .selectAll()
        .where('id', '=', channelId)
        .executeTakeFirstOrThrow();
      const responseBody = toNotificationChannel(row);
      await storeIdempotentResponse(deps.redis, 'createNotificationChannel', idempotencyKey, {
        status: 201,
        body: responseBody,
      });
      // The contract has no GET /notification-channels/{id} (only the list
      // and this create) -- this ETag is the only way a client can ever
      // get a fresh one for the immediately-following PATCH without
      // re-deriving it from a full list fetch.
      return reply.code(201).header('ETag', etagFor(responseBody)).send(responseBody);
    },
  );

  app.patch(
    '/notification-channels/:channelId',
    { preHandler: requireSession(deps) },
    async (request, reply) => {
      const currentUser = request.currentUser!;
      if (!(await requireOperator(db, currentUser.userId))) {
        return reply
          .code(403)
          .type('application/problem+json')
          .send(problem(403, 'auth.forbidden', 'Operator role required'));
      }
      const { channelId } = request.params as { channelId: string };
      const existing = await db
        .selectFrom('notification_channels')
        .selectAll()
        .where('id', '=', channelId)
        .executeTakeFirst();
      if (!existing) {
        return reply
          .code(404)
          .type('application/problem+json')
          .send(problem(404, 'resource.not_found', 'Notification channel not found'));
      }
      const ifMatch = request.headers['if-match'] as string | undefined;
      const currentEtag = etagFor(toNotificationChannel(existing));
      if (!ifMatch || ifMatch !== currentEtag) {
        return reply
          .code(409)
          .type('application/problem+json')
          .send(
            problem(
              409,
              'concurrency.stale_resource',
              'If-Match does not match the current resource',
            ),
          );
      }
      const body = request.body as {
        type?: string;
        config?: Record<string, unknown>;
        secretRef?: string | null;
        isEnabled?: boolean;
      };
      await db
        .updateTable('notification_channels')
        .set({
          ...(body.type ? { type: body.type as never } : {}),
          ...(body.config ? { config: body.config as never } : {}),
          ...(body.secretRef !== undefined ? { secret_ref: body.secretRef } : {}),
          ...(body.isEnabled !== undefined ? { is_enabled: body.isEnabled } : {}),
        })
        .where('id', '=', channelId)
        .execute();
      await appendAuditEntry(db, {
        actorUserId: currentUser.userId,
        sessionId: currentUser.sessionId,
        sourceAddress: sourceAddressOf(request),
        action: 'notification_channel.updated',
        targetType: 'notification_channel',
        targetId: channelId,
        beforeState: null,
        afterState: null,
        outcome: 'success',
      });
      const updated = await db
        .selectFrom('notification_channels')
        .selectAll()
        .where('id', '=', channelId)
        .executeTakeFirstOrThrow();
      const responseBody = toNotificationChannel(updated);
      return reply.code(200).header('ETag', etagFor(responseBody)).send(responseBody);
    },
  );
}
