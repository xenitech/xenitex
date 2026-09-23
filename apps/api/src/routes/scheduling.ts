import type { FastifyInstance } from 'fastify';
import { newId } from '@xenitex/domain';
import type { ApiDependencies } from '../dependencies.js';
import { appendAuditEntry } from '../audit/audit-log.js';
import { requireRole } from '../auth/capabilities.js';
import { problem, requireSession, sourceAddressOf } from './auth.js';
import { getIdempotentResponse, storeIdempotentResponse } from '../lib/idempotency.js';
import { etagFor } from '../lib/etag.js';

async function requireOperator(db: ApiDependencies['db'], userId: string): Promise<boolean> {
  const user = await db
    .selectFrom('users')
    .select('role')
    .where('id', '=', userId)
    .executeTakeFirstOrThrow();
  return requireRole(user.role, 'operator');
}

async function requireAdministrator(db: ApiDependencies['db'], userId: string): Promise<boolean> {
  const user = await db
    .selectFrom('users')
    .select('role')
    .where('id', '=', userId)
    .executeTakeFirstOrThrow();
  return requireRole(user.role, 'administrator');
}

interface PacingConfig {
  packetsPerSecond: number;
  concurrentHosts: number;
  concurrentPortsPerHost: number;
  timeoutMs: number;
  retries: number;
}

function toScanProfile(row: {
  id: string;
  name: string;
  intrusiveness: string;
  pacing: unknown;
  requires_confirmation: boolean;
}) {
  return {
    id: row.id,
    name: row.name,
    intrusiveness: row.intrusiveness,
    pacing: row.pacing,
    requiresConfirmation: row.requires_confirmation,
  };
}

function toPacingCeilings(row: {
  max_packets_per_second: number;
  max_concurrent_hosts: number;
  max_concurrent_ports_per_host: number;
  max_timeout_ms: number;
  max_retries: number;
}) {
  return {
    maxPacketsPerSecond: row.max_packets_per_second,
    maxConcurrentHosts: row.max_concurrent_hosts,
    maxConcurrentPortsPerHost: row.max_concurrent_ports_per_host,
    maxTimeoutMs: row.max_timeout_ms,
    maxRetries: row.max_retries,
  };
}

/** SAFE-04: never above the hard ceiling, checked server-side regardless of what the client requested. */
function exceedsCeilings(
  pacing: PacingConfig,
  ceilings: ReturnType<typeof toPacingCeilings>,
): string | null {
  if (pacing.packetsPerSecond > ceilings.maxPacketsPerSecond) return 'packetsPerSecond';
  if (pacing.concurrentHosts > ceilings.maxConcurrentHosts) return 'concurrentHosts';
  if (pacing.concurrentPortsPerHost > ceilings.maxConcurrentPortsPerHost)
    return 'concurrentPortsPerHost';
  if (pacing.timeoutMs > ceilings.maxTimeoutMs) return 'timeoutMs';
  if (pacing.retries > ceilings.maxRetries) return 'retries';
  return null;
}

export async function registerSchedulingRoutes(
  app: FastifyInstance,
  deps: ApiDependencies,
): Promise<void> {
  const { db, redis } = deps;

  // ------------------------------------------------------------ ScanProfiles
  app.get('/scan-profiles', { preHandler: requireSession(deps) }, async (_request, reply) => {
    const rows = await db
      .selectFrom('scan_profiles')
      .selectAll()
      .orderBy('created_at', 'asc')
      .execute();
    return reply.code(200).send(rows.map(toScanProfile));
  });

  app.post('/scan-profiles', { preHandler: requireSession(deps) }, async (request, reply) => {
    const currentUser = request.currentUser!;
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
    const cached = await getIdempotentResponse(redis, 'createScanProfile', idempotencyKey);
    if (cached) return reply.code(cached.status).send(cached.body);

    const body = request.body as {
      name?: string;
      intrusiveness?: string;
      pacing?: PacingConfig;
    };
    if (!body?.name || !body.intrusiveness || !body.pacing) {
      return reply
        .code(400)
        .type('application/problem+json')
        .send(
          problem(
            400,
            'validation.schema_violation',
            'name, intrusiveness and pacing are required',
          ),
        );
    }
    const ceilingsRow = await db
      .selectFrom('pacing_ceilings')
      .selectAll()
      .where('id', '=', 1)
      .executeTakeFirstOrThrow();
    const overField = exceedsCeilings(body.pacing, toPacingCeilings(ceilingsRow));
    if (overField) {
      return reply
        .code(422)
        .type('application/problem+json')
        .send(
          problem(
            422,
            'scan.pacing_ceiling_exceeded',
            `${overField} exceeds the system-wide pacing ceiling`,
          ),
        );
    }

    const profileId = newId();
    await db
      .insertInto('scan_profiles')
      .values({
        id: profileId,
        name: body.name,
        intrusiveness: body.intrusiveness as never,
        pacing: body.pacing as never,
        // SAFE-03: standard requires typed confirmation at scan-run creation; passive-inventory/safe don't.
        requires_confirmation: body.intrusiveness === 'standard',
        created_by: currentUser.userId,
      })
      .execute();
    await appendAuditEntry(db, {
      actorUserId: currentUser.userId,
      sessionId: currentUser.sessionId,
      sourceAddress: sourceAddressOf(request),
      action: 'scan_profile.created',
      targetType: 'scan_profile',
      targetId: profileId,
      beforeState: null,
      afterState: { name: body.name, intrusiveness: body.intrusiveness },
      outcome: 'success',
    });
    const row = await db
      .selectFrom('scan_profiles')
      .selectAll()
      .where('id', '=', profileId)
      .executeTakeFirstOrThrow();
    const responseBody = toScanProfile(row);
    await storeIdempotentResponse(redis, 'createScanProfile', idempotencyKey, {
      status: 201,
      body: responseBody,
    });
    return reply.code(201).send(responseBody);
  });

  app.get(
    '/scan-profiles/:profileId',
    { preHandler: requireSession(deps) },
    async (request, reply) => {
      const { profileId } = request.params as { profileId: string };
      const row = await db
        .selectFrom('scan_profiles')
        .selectAll()
        .where('id', '=', profileId)
        .executeTakeFirst();
      if (!row) {
        return reply
          .code(404)
          .type('application/problem+json')
          .send(problem(404, 'resource.not_found', 'Scan profile not found'));
      }
      return reply
        .code(200)
        .header('ETag', etagFor(toScanProfile(row)))
        .send(toScanProfile(row));
    },
  );

  app.patch(
    '/scan-profiles/:profileId',
    { preHandler: requireSession(deps) },
    async (request, reply) => {
      const currentUser = request.currentUser!;
      if (!(await requireOperator(db, currentUser.userId))) {
        return reply
          .code(403)
          .type('application/problem+json')
          .send(problem(403, 'auth.forbidden', 'Operator role required'));
      }
      const { profileId } = request.params as { profileId: string };
      const existing = await db
        .selectFrom('scan_profiles')
        .selectAll()
        .where('id', '=', profileId)
        .executeTakeFirst();
      if (!existing) {
        return reply
          .code(404)
          .type('application/problem+json')
          .send(problem(404, 'resource.not_found', 'Scan profile not found'));
      }
      const ifMatch = request.headers['if-match'] as string | undefined;
      if (!ifMatch || ifMatch !== etagFor(toScanProfile(existing))) {
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
      const body = request.body as { name?: string; intrusiveness?: string; pacing?: PacingConfig };
      if (body.pacing) {
        const ceilingsRow = await db
          .selectFrom('pacing_ceilings')
          .selectAll()
          .where('id', '=', 1)
          .executeTakeFirstOrThrow();
        const overField = exceedsCeilings(body.pacing, toPacingCeilings(ceilingsRow));
        if (overField) {
          return reply
            .code(422)
            .type('application/problem+json')
            .send(
              problem(
                422,
                'scan.pacing_ceiling_exceeded',
                `${overField} exceeds the system-wide pacing ceiling`,
              ),
            );
        }
      }
      await db
        .updateTable('scan_profiles')
        .set({
          ...(body.name ? { name: body.name } : {}),
          ...(body.intrusiveness
            ? {
                intrusiveness: body.intrusiveness as never,
                requires_confirmation: body.intrusiveness === 'standard',
              }
            : {}),
          ...(body.pacing ? { pacing: body.pacing as never } : {}),
          updated_at: new Date(),
        })
        .where('id', '=', profileId)
        .execute();
      await appendAuditEntry(db, {
        actorUserId: currentUser.userId,
        sessionId: currentUser.sessionId,
        sourceAddress: sourceAddressOf(request),
        action: 'scan_profile.updated',
        targetType: 'scan_profile',
        targetId: profileId,
        beforeState: null,
        afterState: null,
        outcome: 'success',
      });
      const updated = await db
        .selectFrom('scan_profiles')
        .selectAll()
        .where('id', '=', profileId)
        .executeTakeFirstOrThrow();
      return reply
        .code(200)
        .header('ETag', etagFor(toScanProfile(updated)))
        .send(toScanProfile(updated));
    },
  );

  // --------------------------------------------------------- PacingCeilings
  app.get('/pacing-ceilings', { preHandler: requireSession(deps) }, async (_request, reply) => {
    const row = await db
      .selectFrom('pacing_ceilings')
      .selectAll()
      .where('id', '=', 1)
      .executeTakeFirstOrThrow();
    return reply
      .code(200)
      .header('ETag', etagFor(toPacingCeilings(row)))
      .send(toPacingCeilings(row));
  });

  app.patch('/pacing-ceilings', { preHandler: requireSession(deps) }, async (request, reply) => {
    const currentUser = request.currentUser!;
    if (!(await requireAdministrator(db, currentUser.userId))) {
      return reply
        .code(403)
        .type('application/problem+json')
        .send(problem(403, 'auth.forbidden', 'Administrator role required'));
    }
    const existing = await db
      .selectFrom('pacing_ceilings')
      .selectAll()
      .where('id', '=', 1)
      .executeTakeFirstOrThrow();
    const ifMatch = request.headers['if-match'] as string | undefined;
    if (!ifMatch || ifMatch !== etagFor(toPacingCeilings(existing))) {
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
    const body = request.body as Partial<{
      maxPacketsPerSecond: number;
      maxConcurrentHosts: number;
      maxConcurrentPortsPerHost: number;
      maxTimeoutMs: number;
      maxRetries: number;
    }>;
    await db
      .updateTable('pacing_ceilings')
      .set({
        ...(body.maxPacketsPerSecond !== undefined
          ? { max_packets_per_second: body.maxPacketsPerSecond }
          : {}),
        ...(body.maxConcurrentHosts !== undefined
          ? { max_concurrent_hosts: body.maxConcurrentHosts }
          : {}),
        ...(body.maxConcurrentPortsPerHost !== undefined
          ? { max_concurrent_ports_per_host: body.maxConcurrentPortsPerHost }
          : {}),
        ...(body.maxTimeoutMs !== undefined ? { max_timeout_ms: body.maxTimeoutMs } : {}),
        ...(body.maxRetries !== undefined ? { max_retries: body.maxRetries } : {}),
        updated_by: currentUser.userId,
        updated_at: new Date(),
      })
      .where('id', '=', 1)
      .execute();
    await appendAuditEntry(db, {
      actorUserId: currentUser.userId,
      sessionId: currentUser.sessionId,
      sourceAddress: sourceAddressOf(request),
      action: 'pacing_ceilings.updated',
      targetType: 'pacing_ceilings',
      targetId: '1',
      beforeState: toPacingCeilings(existing),
      afterState: null,
      outcome: 'success',
    });
    const updated = await db
      .selectFrom('pacing_ceilings')
      .selectAll()
      .where('id', '=', 1)
      .executeTakeFirstOrThrow();
    return reply
      .code(200)
      .header('ETag', etagFor(toPacingCeilings(updated)))
      .send(toPacingCeilings(updated));
  });

  // -------------------------------------------------------- BlackoutWindows
  app.get('/blackout-windows', { preHandler: requireSession(deps) }, async (_request, reply) => {
    const rows = await db
      .selectFrom('blackout_windows')
      .selectAll()
      .orderBy('starts_at', 'asc')
      .execute();
    return reply.code(200).send(
      rows.map((row) => ({
        id: row.id,
        scopeId: row.scope_id,
        name: row.name,
        timezone: row.timezone,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        isRecurring: row.is_recurring,
        rrule: row.rrule,
      })),
    );
  });

  app.post('/blackout-windows', { preHandler: requireSession(deps) }, async (request, reply) => {
    const currentUser = request.currentUser!;
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
    const cached = await getIdempotentResponse(redis, 'createBlackoutWindow', idempotencyKey);
    if (cached) return reply.code(cached.status).send(cached.body);

    const body = request.body as {
      scopeId?: string | null;
      name?: string;
      timezone?: string;
      startsAt?: string;
      endsAt?: string;
      isRecurring?: boolean;
      rrule?: string | null;
    };
    if (!body?.name || !body.timezone || !body.startsAt || !body.endsAt) {
      return reply
        .code(400)
        .type('application/problem+json')
        .send(
          problem(
            400,
            'validation.schema_violation',
            'name, timezone, startsAt and endsAt are required',
          ),
        );
    }
    if (new Date(body.endsAt) <= new Date(body.startsAt)) {
      return reply
        .code(400)
        .type('application/problem+json')
        .send(problem(400, 'validation.schema_violation', 'endsAt must be after startsAt'));
    }
    const windowId = newId();
    await db
      .insertInto('blackout_windows')
      .values({
        id: windowId,
        scope_id: body.scopeId ?? null,
        name: body.name,
        timezone: body.timezone,
        starts_at: new Date(body.startsAt),
        ends_at: new Date(body.endsAt),
        is_recurring: body.isRecurring ?? false,
        rrule: body.rrule ?? null,
        created_by: currentUser.userId,
      })
      .execute();
    await appendAuditEntry(db, {
      actorUserId: currentUser.userId,
      sessionId: currentUser.sessionId,
      sourceAddress: sourceAddressOf(request),
      action: 'blackout_window.created',
      targetType: 'blackout_window',
      targetId: windowId,
      beforeState: null,
      afterState: { name: body.name, startsAt: body.startsAt, endsAt: body.endsAt },
      outcome: 'success',
    });
    const row = await db
      .selectFrom('blackout_windows')
      .selectAll()
      .where('id', '=', windowId)
      .executeTakeFirstOrThrow();
    const responseBody = {
      id: row.id,
      scopeId: row.scope_id,
      name: row.name,
      timezone: row.timezone,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      isRecurring: row.is_recurring,
      rrule: row.rrule,
    };
    await storeIdempotentResponse(redis, 'createBlackoutWindow', idempotencyKey, {
      status: 201,
      body: responseBody,
    });
    return reply.code(201).send(responseBody);
  });

  // ---------------------------------------------------------- ScanSchedules
  app.get('/scan-schedules', { preHandler: requireSession(deps) }, async (_request, reply) => {
    const rows = await db
      .selectFrom('scan_schedules')
      .selectAll()
      .orderBy('created_at', 'asc')
      .execute();
    return reply.code(200).send(
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        scopeId: row.scope_id,
        profileId: row.profile_id,
        cronExpression: row.cron_expression,
        timezone: row.timezone,
        nextRunAt: row.next_run_at,
        isEnabled: row.is_enabled,
      })),
    );
  });

  app.post('/scan-schedules', { preHandler: requireSession(deps) }, async (request, reply) => {
    const currentUser = request.currentUser!;
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
    const cached = await getIdempotentResponse(redis, 'createScanSchedule', idempotencyKey);
    if (cached) return reply.code(cached.status).send(cached.body);

    const body = request.body as {
      name?: string;
      scopeId?: string;
      profileId?: string;
      cronExpression?: string;
      timezone?: string;
    };
    if (!body?.name || !body.scopeId || !body.profileId || !body.cronExpression || !body.timezone) {
      return reply
        .code(400)
        .type('application/problem+json')
        .send(
          problem(
            400,
            'validation.schema_violation',
            'name, scopeId, profileId, cronExpression and timezone are required',
          ),
        );
    }
    const scheduleId = newId();
    try {
      await db
        .insertInto('scan_schedules')
        .values({
          id: scheduleId,
          name: body.name,
          scope_id: body.scopeId,
          profile_id: body.profileId,
          cron_expression: body.cronExpression,
          timezone: body.timezone,
          created_by: currentUser.userId,
        })
        .execute();
    } catch {
      return reply
        .code(400)
        .type('application/problem+json')
        .send(problem(400, 'validation.schema_violation', 'Invalid scopeId or profileId'));
    }
    await appendAuditEntry(db, {
      actorUserId: currentUser.userId,
      sessionId: currentUser.sessionId,
      sourceAddress: sourceAddressOf(request),
      action: 'scan_schedule.created',
      targetType: 'scan_schedule',
      targetId: scheduleId,
      beforeState: null,
      afterState: { name: body.name, cronExpression: body.cronExpression },
      outcome: 'success',
    });
    const row = await db
      .selectFrom('scan_schedules')
      .selectAll()
      .where('id', '=', scheduleId)
      .executeTakeFirstOrThrow();
    const responseBody = {
      id: row.id,
      name: row.name,
      scopeId: row.scope_id,
      profileId: row.profile_id,
      cronExpression: row.cron_expression,
      timezone: row.timezone,
      nextRunAt: row.next_run_at,
      isEnabled: row.is_enabled,
    };
    await storeIdempotentResponse(redis, 'createScanSchedule', idempotencyKey, {
      status: 201,
      body: responseBody,
    });
    return reply.code(201).send(responseBody);
  });

  // ------------------------------------- BlackoutWindow / ScanSchedule detail
  // SAFE-06 and 3.6 both describe windows and schedules as managed objects,
  // but only list-and-create existed: a window entered with the wrong hours
  // could not be corrected or removed through the API at all, and a
  // schedule could not be paused. Both are now editable and removable, the
  // same way the contract has always said they were.

  function toBlackoutWindow(row: {
    id: string;
    scope_id: string | null;
    name: string;
    timezone: string;
    starts_at: Date | string;
    ends_at: Date | string;
    is_recurring: boolean;
    rrule: string | null;
  }) {
    return {
      id: row.id,
      scopeId: row.scope_id,
      name: row.name,
      timezone: row.timezone,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      isRecurring: row.is_recurring,
      rrule: row.rrule,
    };
  }

  app.patch(
    '/blackout-windows/:windowId',
    { preHandler: requireSession(deps) },
    async (request, reply) => {
      const currentUser = request.currentUser!;
      if (!(await requireOperator(db, currentUser.userId))) {
        return reply
          .code(403)
          .type('application/problem+json')
          .send(problem(403, 'auth.forbidden', 'Operator role required'));
      }
      const { windowId } = request.params as { windowId: string };
      const existing = await db
        .selectFrom('blackout_windows')
        .selectAll()
        .where('id', '=', windowId)
        .executeTakeFirst();
      if (!existing) {
        return reply
          .code(404)
          .type('application/problem+json')
          .send(problem(404, 'resource.not_found', 'Blackout window not found'));
      }

      const body = request.body as {
        name?: string;
        startsAt?: string;
        endsAt?: string;
        timezone?: string;
      };
      const updates: Record<string, unknown> = {};
      if (body?.name !== undefined) updates.name = body.name;
      if (body?.timezone !== undefined) updates.timezone = body.timezone;
      if (body?.startsAt !== undefined) updates.starts_at = new Date(body.startsAt);
      if (body?.endsAt !== undefined) updates.ends_at = new Date(body.endsAt);
      if (Object.keys(updates).length === 0) {
        return reply
          .code(400)
          .type('application/problem+json')
          .send(problem(400, 'validation.schema_violation', 'No updatable fields were supplied'));
      }

      // `blackout_window_valid_range` would otherwise reject this as a raw
      // Postgres constraint violation; checked here so the operator gets a
      // problem document naming the actual mistake.
      const startsAt = (updates.starts_at as Date | undefined) ?? new Date(existing.starts_at);
      const endsAt = (updates.ends_at as Date | undefined) ?? new Date(existing.ends_at);
      if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
        return reply
          .code(400)
          .type('application/problem+json')
          .send(
            problem(400, 'validation.schema_violation', 'startsAt/endsAt must be valid timestamps'),
          );
      }
      if (endsAt <= startsAt) {
        return reply
          .code(400)
          .type('application/problem+json')
          .send(problem(400, 'validation.schema_violation', 'endsAt must be after startsAt'));
      }

      await db.updateTable('blackout_windows').set(updates).where('id', '=', windowId).execute();
      await appendAuditEntry(db, {
        actorUserId: currentUser.userId,
        sessionId: currentUser.sessionId,
        sourceAddress: sourceAddressOf(request),
        action: 'blackout_window.updated',
        targetType: 'blackout_window',
        targetId: windowId,
        beforeState: toBlackoutWindow(existing),
        afterState: updates,
        outcome: 'success',
      });

      const row = await db
        .selectFrom('blackout_windows')
        .selectAll()
        .where('id', '=', windowId)
        .executeTakeFirstOrThrow();
      return reply.code(200).send(toBlackoutWindow(row));
    },
  );

  app.delete(
    '/blackout-windows/:windowId',
    { preHandler: requireSession(deps) },
    async (request, reply) => {
      const currentUser = request.currentUser!;
      if (!(await requireOperator(db, currentUser.userId))) {
        return reply
          .code(403)
          .type('application/problem+json')
          .send(problem(403, 'auth.forbidden', 'Operator role required'));
      }
      const { windowId } = request.params as { windowId: string };
      const existing = await db
        .selectFrom('blackout_windows')
        .selectAll()
        .where('id', '=', windowId)
        .executeTakeFirst();
      if (!existing) {
        return reply
          .code(404)
          .type('application/problem+json')
          .send(problem(404, 'resource.not_found', 'Blackout window not found'));
      }

      await db.deleteFrom('blackout_windows').where('id', '=', windowId).execute();
      // SAFE-06: removing a blackout window removes a protection — it lets
      // scans run during hours someone deliberately fenced off — so the
      // full prior definition is recorded, not just the id.
      await appendAuditEntry(db, {
        actorUserId: currentUser.userId,
        sessionId: currentUser.sessionId,
        sourceAddress: sourceAddressOf(request),
        action: 'blackout_window.deleted',
        targetType: 'blackout_window',
        targetId: windowId,
        beforeState: toBlackoutWindow(existing),
        afterState: null,
        outcome: 'success',
      });
      return reply.code(204).send();
    },
  );

  function toScanSchedule(row: {
    id: string;
    name: string;
    scope_id: string;
    profile_id: string;
    cron_expression: string;
    timezone: string;
    next_run_at: Date | string | null;
    is_enabled: boolean;
  }) {
    return {
      id: row.id,
      name: row.name,
      scopeId: row.scope_id,
      profileId: row.profile_id,
      cronExpression: row.cron_expression,
      timezone: row.timezone,
      nextRunAt: row.next_run_at,
      isEnabled: row.is_enabled,
    };
  }

  app.get(
    '/scan-schedules/:scheduleId',
    { preHandler: requireSession(deps) },
    async (request, reply) => {
      const { scheduleId } = request.params as { scheduleId: string };
      const row = await db
        .selectFrom('scan_schedules')
        .selectAll()
        .where('id', '=', scheduleId)
        .executeTakeFirst();
      if (!row) {
        return reply
          .code(404)
          .type('application/problem+json')
          .send(problem(404, 'resource.not_found', 'Scan schedule not found'));
      }
      reply.header('ETag', etagFor(toScanSchedule(row)));
      return reply.code(200).send(toScanSchedule(row));
    },
  );

  app.patch(
    '/scan-schedules/:scheduleId',
    { preHandler: requireSession(deps) },
    async (request, reply) => {
      const currentUser = request.currentUser!;
      if (!(await requireOperator(db, currentUser.userId))) {
        return reply
          .code(403)
          .type('application/problem+json')
          .send(problem(403, 'auth.forbidden', 'Operator role required'));
      }
      const { scheduleId } = request.params as { scheduleId: string };
      const existing = await db
        .selectFrom('scan_schedules')
        .selectAll()
        .where('id', '=', scheduleId)
        .executeTakeFirst();
      if (!existing) {
        return reply
          .code(404)
          .type('application/problem+json')
          .send(problem(404, 'resource.not_found', 'Scan schedule not found'));
      }

      const body = request.body as {
        name?: string;
        cronExpression?: string;
        timezone?: string;
        isEnabled?: boolean;
      };
      const updates: Record<string, unknown> = {};
      if (body?.name !== undefined) updates.name = body.name;
      if (body?.cronExpression !== undefined) updates.cron_expression = body.cronExpression;
      if (body?.timezone !== undefined) updates.timezone = body.timezone;
      if (body?.isEnabled !== undefined) updates.is_enabled = body.isEnabled;
      if (Object.keys(updates).length === 0) {
        return reply
          .code(400)
          .type('application/problem+json')
          .send(problem(400, 'validation.schema_violation', 'No updatable fields were supplied'));
      }

      await db.updateTable('scan_schedules').set(updates).where('id', '=', scheduleId).execute();
      await appendAuditEntry(db, {
        actorUserId: currentUser.userId,
        sessionId: currentUser.sessionId,
        sourceAddress: sourceAddressOf(request),
        action: 'scan_schedule.updated',
        targetType: 'scan_schedule',
        targetId: scheduleId,
        beforeState: toScanSchedule(existing),
        afterState: updates,
        outcome: 'success',
      });

      const row = await db
        .selectFrom('scan_schedules')
        .selectAll()
        .where('id', '=', scheduleId)
        .executeTakeFirstOrThrow();
      reply.header('ETag', etagFor(toScanSchedule(row)));
      return reply.code(200).send(toScanSchedule(row));
    },
  );

  app.delete(
    '/scan-schedules/:scheduleId',
    { preHandler: requireSession(deps) },
    async (request, reply) => {
      const currentUser = request.currentUser!;
      if (!(await requireOperator(db, currentUser.userId))) {
        return reply
          .code(403)
          .type('application/problem+json')
          .send(problem(403, 'auth.forbidden', 'Operator role required'));
      }
      const { scheduleId } = request.params as { scheduleId: string };
      const existing = await db
        .selectFrom('scan_schedules')
        .selectAll()
        .where('id', '=', scheduleId)
        .executeTakeFirst();
      if (!existing) {
        return reply
          .code(404)
          .type('application/problem+json')
          .send(problem(404, 'resource.not_found', 'Scan schedule not found'));
      }
      await db.deleteFrom('scan_schedules').where('id', '=', scheduleId).execute();
      await appendAuditEntry(db, {
        actorUserId: currentUser.userId,
        sessionId: currentUser.sessionId,
        sourceAddress: sourceAddressOf(request),
        action: 'scan_schedule.deleted',
        targetType: 'scan_schedule',
        targetId: scheduleId,
        beforeState: toScanSchedule(existing),
        afterState: null,
        outcome: 'success',
      });
      return reply.code(204).send();
    },
  );
}
