import type { FastifyInstance } from 'fastify';
import { sql } from '@xenitex/db';
import { newId } from '@xenitex/domain';
import type { ApiDependencies } from '../dependencies.js';
import { appendAuditEntry } from '../audit/audit-log.js';
import { requireRole } from '../auth/capabilities.js';
import { problem, requireSession, sourceAddressOf } from './auth.js';
import { buildPage, decodeCursor, parseLimit } from '../lib/pagination.js';
import { getIdempotentResponse, storeIdempotentResponse } from '../lib/idempotency.js';
import { expandCidrRanges, isIpv4InCidr } from '@xenitex/domain';

const PLAN_PREVIEW_TTL_MINUTES = 15;

async function requireOperator(db: ApiDependencies['db'], userId: string): Promise<boolean> {
  const user = await db
    .selectFrom('users')
    .select('role')
    .where('id', '=', userId)
    .executeTakeFirstOrThrow();
  return requireRole(user.role, 'operator');
}

export interface ScanRunRow {
  id: string;
  plan_preview_id: string;
  scope_id: string;
  profile_id: string;
  initiated_by_user_id: string | null;
  status: string;
  correlation_id: string;
  queued_at: Date | string;
  started_at: Date | string | null;
  completed_at: Date | string | null;
  aborted_by_user_id: string | null;
  targets_completed: string | number;
  targets_total: string | number;
}

export function toScanRun(row: ScanRunRow) {
  return {
    id: row.id,
    planPreviewId: row.plan_preview_id,
    scopeId: row.scope_id,
    profileId: row.profile_id,
    initiatedByUserId: row.initiated_by_user_id,
    status: row.status,
    correlationId: row.correlation_id,
    queuedAt: row.queued_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    abortedByUserId: row.aborted_by_user_id,
    targetsCompleted: Number(row.targets_completed),
    targetsTotal: Number(row.targets_total),
  };
}

export function scanRunSelect(db: ApiDependencies['db']) {
  return db
    .selectFrom('scan_runs')
    .leftJoin('scan_run_targets', 'scan_run_targets.scan_run_id', 'scan_runs.id')
    .select([
      'scan_runs.id',
      'scan_runs.plan_preview_id',
      'scan_runs.scope_id',
      'scan_runs.profile_id',
      'scan_runs.initiated_by_user_id',
      'scan_runs.status',
      'scan_runs.correlation_id',
      'scan_runs.queued_at',
      'scan_runs.started_at',
      'scan_runs.completed_at',
      'scan_runs.aborted_by_user_id',
      sql<number>`count(scan_run_targets.id) filter (where scan_run_targets.status = 'completed')`.as(
        'targets_completed',
      ),
      sql<number>`count(scan_run_targets.id)`.as('targets_total'),
    ])
    .groupBy('scan_runs.id');
}

export async function registerScanRoutes(
  app: FastifyInstance,
  deps: ApiDependencies,
): Promise<void> {
  const { db } = deps;

  app.get('/scan-runs', { preHandler: requireSession(deps) }, async (request, reply) => {
    const query = request.query as { cursor?: string; limit?: string; status?: string };
    const limit = parseLimit(query.limit);
    const cursorId = query.cursor ? decodeCursor(query.cursor) : null;

    let q = scanRunSelect(db)
      .orderBy('scan_runs.id', 'asc')
      .limit(limit + 1);
    if (cursorId) q = q.where('scan_runs.id', '>', cursorId);
    if (query.status) q = q.where('scan_runs.status', '=', query.status as never);
    const rows = await q.execute();

    return reply.code(200).send(buildPage(rows as ScanRunRow[], limit, toScanRun));
  });

  app.get('/scan-runs/:scanRunId', { preHandler: requireSession(deps) }, async (request, reply) => {
    const { scanRunId } = request.params as { scanRunId: string };
    const row = await scanRunSelect(db).where('scan_runs.id', '=', scanRunId).executeTakeFirst();
    if (!row) {
      return reply
        .code(404)
        .type('application/problem+json')
        .send(problem(404, 'resource.not_found', 'Scan run not found'));
    }
    return reply.code(200).send(toScanRun(row as ScanRunRow));
  });

  app.get(
    '/scan-runs/:scanRunId/targets',
    { preHandler: requireSession(deps) },
    async (request, reply) => {
      const { scanRunId } = request.params as { scanRunId: string };
      const query = request.query as { cursor?: string; limit?: string };
      const limit = parseLimit(query.limit);
      const cursorId = query.cursor ? decodeCursor(query.cursor) : null;

      let q = db
        .selectFrom('scan_run_targets')
        .selectAll()
        .where('scan_run_id', '=', scanRunId)
        .orderBy('id', 'asc')
        .limit(limit + 1);
      if (cursorId) q = q.where('id', '>', cursorId);
      const rows = await q.execute();

      return reply.code(200).send(
        buildPage(rows, limit, (row) => ({
          id: row.id,
          scanRunId: row.scan_run_id,
          targetAddress: row.target_address,
          targetPort: row.target_port,
          status: row.status,
          excludedByRuleId: row.excluded_by_rule_id,
          fragileRuleId: row.fragile_rule_id,
          adapterKey: row.adapter_key,
          startedAt: row.started_at,
          completedAt: row.completed_at,
          failureClass: row.failure_class,
        })),
      );
    },
  );

  app.get(
    '/scan-runs/:scanRunId/raw-artifacts',
    { preHandler: requireSession(deps) },
    async (request, reply) => {
      const { scanRunId } = request.params as { scanRunId: string };
      const rows = await db
        .selectFrom('raw_artifacts')
        .innerJoin('scanner_adapters', 'scanner_adapters.id', 'raw_artifacts.scanner_adapter_id')
        .select([
          'raw_artifacts.id',
          'raw_artifacts.scan_run_id',
          'raw_artifacts.content_type',
          'raw_artifacts.size_bytes',
          'raw_artifacts.sha256',
          'raw_artifacts.captured_at',
          'scanner_adapters.adapter_key',
        ])
        .where('raw_artifacts.scan_run_id', '=', scanRunId)
        .orderBy('raw_artifacts.captured_at', 'asc')
        .execute();
      return reply.code(200).send(
        rows.map((row) => ({
          id: row.id,
          scanRunId: row.scan_run_id,
          scannerAdapterKey: row.adapter_key,
          contentType: row.content_type,
          sizeBytes: Number(row.size_bytes),
          sha256: row.sha256,
          capturedAt: row.captured_at,
        })),
      );
    },
  );

  // ------------------------------------------------------------- ScanPlans
  app.post('/scan-plans', { preHandler: requireSession(deps) }, async (request, reply) => {
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
    const cached = await getIdempotentResponse(deps.redis, 'createScanPlan', idempotencyKey);
    if (cached) return reply.code(cached.status).send(cached.body);

    const body = request.body as { scopeId?: string; profileId?: string };
    if (!body?.scopeId || !body.profileId) {
      return reply
        .code(400)
        .type('application/problem+json')
        .send(problem(400, 'validation.schema_violation', 'scopeId and profileId are required'));
    }
    const [scope, profile] = await Promise.all([
      db
        .selectFrom('authorized_scopes')
        .selectAll()
        .where('id', '=', body.scopeId)
        .executeTakeFirst(),
      db
        .selectFrom('scan_profiles')
        .selectAll()
        .where('id', '=', body.profileId)
        .executeTakeFirst(),
    ]);
    if (!scope) {
      return reply
        .code(400)
        .type('application/problem+json')
        .send(
          problem(
            400,
            'validation.schema_violation',
            'scopeId does not reference a real authorized scope',
          ),
        );
    }
    // SAFE-01: an active scope is never superseded -- a superseded scope's
    // CIDR/hostname grant is not the current authorisation on record.
    if (scope.superseded_by_id) {
      return reply
        .code(422)
        .type('application/problem+json')
        .send(problem(422, 'scan.scope_superseded', 'This authorized scope has been superseded'));
    }
    if (!profile) {
      return reply
        .code(400)
        .type('application/problem+json')
        .send(
          problem(
            400,
            'validation.schema_violation',
            'profileId does not reference a real scan profile',
          ),
        );
    }

    const { addresses, truncated } = expandCidrRanges(scope.cidr_ranges as unknown as string[]);
    const allTargets = [...addresses, ...scope.hostnames];

    // SAFE-02: exclusion enforcement, layer 1 of 2 (plan validation) -- the
    // worker re-checks immediately before dispatch (layer 2), since this
    // list can go stale between preview and execution.
    const exclusionRules = await db
      .selectFrom('exclusion_rules')
      .selectAll()
      .where('is_active', '=', true)
      .where((eb) => eb.or([eb('scope_id', '=', body.scopeId!), eb('scope_id', 'is', null)]))
      .execute();
    const addressExclusions = new Map(
      exclusionRules.filter((r) => r.rule_type === 'address').map((r) => [r.value, r.id]),
    );
    const rangeExclusions = exclusionRules.filter((r) => r.rule_type === 'range');
    const excludedTargets: { target: string; ruleId: string }[] = [];
    const inBoundsTargets: string[] = [];
    for (const target of allTargets) {
      const directHit = addressExclusions.get(target);
      if (directHit) {
        excludedTargets.push({ target, ruleId: directHit });
        continue;
      }
      // O(1) mask comparison per (target, rule). This used to call
      // expandCidrRanges([rule.value]).addresses.includes(target) INSIDE
      // this loop — materialising the rule's entire address list, up to
      // 65,536 strings, and then linearly scanning it, once per target.
      // A /16 scope with a single range exclusion is 65,536 targets x
      // 65,536 comparisons: the request never returns, and it is a
      // safety-control path, so the failure mode was "operator cannot
      // create a plan at all" on exactly the scope sizes PERF-03 targets.
      const rangeHit = rangeExclusions.find((r) => isIpv4InCidr(target, r.value));
      if (rangeHit) {
        excludedTargets.push({ target, ruleId: rangeHit.id });
        continue;
      }
      inBoundsTargets.push(target);
    }

    if (inBoundsTargets.length === 0) {
      return reply
        .code(422)
        .type('application/problem+json')
        .send(
          problem(
            422,
            'scan.no_in_bounds_targets',
            'This scope has no in-bounds targets after exclusions',
          ),
        );
    }

    const pacing = profile.pacing as {
      packetsPerSecond?: number;
      concurrentHosts?: number;
      concurrentPortsPerHost?: number;
    };
    // Defensive, not redundant with POST /scan-profiles's own validation:
    // that's the only path that enforces PacingConfig's shape, but it isn't
    // the only way a row can end up in this table (seed data, a future
    // bulk-import tool). A malformed pacing blob must fail cleanly here,
    // not surface as a raw Postgres "invalid input syntax for type bigint:
    // NaN" from the INSERT three lines down.
    if (
      typeof pacing.packetsPerSecond !== 'number' ||
      typeof pacing.concurrentPortsPerHost !== 'number' ||
      typeof pacing.concurrentHosts !== 'number'
    ) {
      return reply
        .code(422)
        .type('application/problem+json')
        .send(
          problem(
            422,
            'scan.profile_pacing_invalid',
            'This scan profile has an incomplete pacing configuration and cannot be planned against',
          ),
        );
    }
    const estimatedPacketVolume = inBoundsTargets.length * pacing.concurrentPortsPerHost;
    const estimatedDurationSeconds = Math.max(
      1,
      Math.ceil(estimatedPacketVolume / Math.max(1, pacing.packetsPerSecond)),
    );

    const previewId = newId();
    await db
      .insertInto('scan_plan_previews')
      .values({
        id: previewId,
        scope_id: body.scopeId,
        profile_id: body.profileId,
        target_count: inBoundsTargets.length,
        estimated_packet_volume: estimatedPacketVolume,
        estimated_duration_seconds: estimatedDurationSeconds,
        // JSON.stringify explicitly: pg/Kysely serializes a bare JS array
        // as a Postgres array literal ("{...}"), not JSON, so handing a
        // plain array to a jsonb column fails with "invalid input syntax
        // for type json" -- a plain object doesn't hit this (that's why
        // audit-log.ts's jsonb columns, which are always objects, never
        // tripped over it). A JSON string is unambiguous either way.
        excluded_targets: JSON.stringify(
          excludedTargets.map((e) => ({ target: e.target, ruleId: e.ruleId })),
        ) as never,
        // SAFE-05: fragile-device downgrade matching needs prior
        // observation data (OS/banner) this plan-time computation doesn't
        // have -- an unscanned target can't yet be classified fragile.
        // Real downgrade happens per-target inside the worker once a scan
        // is running and a target starts matching a fragile_device_rules
        // heuristic; this preview is honest that it has nothing to show yet.
        fragile_downgrades: JSON.stringify([]) as never,
      })
      .execute();

    const truncationNote = truncated
      ? ` (target list truncated at the ${inBoundsTargets.length + excludedTargets.length}-address planning cap)`
      : '';
    const row = await db
      .selectFrom('scan_plan_previews')
      .selectAll()
      .where('id', '=', previewId)
      .executeTakeFirstOrThrow();
    const responseBody = {
      id: row.id,
      scopeId: row.scope_id,
      profileId: row.profile_id,
      targetCount: row.target_count,
      // estimated_packet_volume is bigint -> Kysely's Int8 (string-typed,
      // precision-safe by default); the contract requires a real integer.
      // Packet-volume estimates for a single scan plan are nowhere near
      // Number.MAX_SAFE_INTEGER, so this conversion is safe here.
      estimatedPacketVolume: Number(row.estimated_packet_volume),
      estimatedDurationSeconds: row.estimated_duration_seconds,
      excludedTargets: row.excluded_targets,
      fragileDowngrades: row.fragile_downgrades,
      generatedAt: row.generated_at,
      confirmedByUserId: row.confirmed_by_user_id,
      confirmedAt: row.confirmed_at,
      note: truncated ? `Target list was capped for planning purposes${truncationNote}` : undefined,
    };
    await storeIdempotentResponse(deps.redis, 'createScanPlan', idempotencyKey, {
      status: 201,
      body: responseBody,
    });
    return reply.code(201).send(responseBody);
  });

  // -------------------------------------------------------- ScanRun create
  app.post('/scan-runs', { preHandler: requireSession(deps) }, async (request, reply) => {
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
    const cached = await getIdempotentResponse(deps.redis, 'createScanRun', idempotencyKey);
    if (cached) return reply.code(cached.status).send(cached.body);

    const body = request.body as {
      planPreviewId?: string;
      confirm?: boolean;
      standardProfileConfirmationText?: string;
    };
    if (!body?.planPreviewId || body.confirm !== true) {
      return reply
        .code(400)
        .type('application/problem+json')
        .send(
          problem(
            400,
            'validation.schema_violation',
            'planPreviewId is required and confirm must be true',
          ),
        );
    }
    const plan = await db
      .selectFrom('scan_plan_previews')
      .selectAll()
      .where('id', '=', body.planPreviewId)
      .executeTakeFirst();
    if (!plan) {
      return reply
        .code(404)
        .type('application/problem+json')
        .send(problem(404, 'resource.not_found', 'Plan preview not found'));
    }
    if (plan.confirmed_at) {
      return reply
        .code(410)
        .type('application/problem+json')
        .send(
          problem(410, 'scan.plan_already_confirmed', 'This plan preview was already confirmed'),
        );
    }
    const ageMinutes = (Date.now() - new Date(plan.generated_at).getTime()) / 60_000;
    if (ageMinutes > PLAN_PREVIEW_TTL_MINUTES) {
      return reply
        .code(410)
        .type('application/problem+json')
        .send(
          problem(410, 'scan.plan_expired', 'This plan preview has expired; request a new one'),
        );
    }
    const profile = await db
      .selectFrom('scan_profiles')
      .selectAll()
      .where('id', '=', plan.profile_id)
      .executeTakeFirstOrThrow();
    // SAFE-03: standard requires typed confirmation and records who confirmed.
    if (profile.requires_confirmation && body.standardProfileConfirmationText !== profile.name) {
      return reply
        .code(422)
        .type('application/problem+json')
        .send(
          problem(
            422,
            'scan.standard_confirmation_required',
            `standardProfileConfirmationText must exactly match the profile name "${profile.name}"`,
          ),
        );
    }

    const scanRunId = newId();
    const correlationId = newId();
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('scan_plan_previews')
        .set({ confirmed_by_user_id: currentUser.userId, confirmed_at: new Date() })
        .where('id', '=', plan.id)
        .execute();
      await trx
        .insertInto('scan_runs')
        .values({
          id: scanRunId,
          plan_preview_id: plan.id,
          scope_id: plan.scope_id,
          profile_id: plan.profile_id,
          initiated_by_user_id: currentUser.userId,
          status: 'queued',
          correlation_id: correlationId,
        })
        .execute();
      const excludedTargets = plan.excluded_targets as unknown as {
        target: string;
        ruleId: string;
      }[];
      const excludedByTarget = new Map(excludedTargets.map((e) => [e.target, e.ruleId]));
      const scope = await trx
        .selectFrom('authorized_scopes')
        .select(['cidr_ranges', 'hostnames'])
        .where('id', '=', plan.scope_id)
        .executeTakeFirstOrThrow();
      const { addresses } = expandCidrRanges(scope.cidr_ranges as unknown as string[]);
      const allTargets = [...addresses, ...scope.hostnames];
      const targetRows = allTargets.map((target) => {
        const excludedRuleId = excludedByTarget.get(target);
        return {
          id: newId(),
          scan_run_id: scanRunId,
          target_address: target,
          status: excludedRuleId ? ('excluded' as const) : ('pending' as const),
          excluded_by_rule_id: excludedRuleId ?? null,
          // Real adapter assignment happens in the worker once it picks a
          // target up, not here -- the API does not guess which adapter
          // will run it.
          adapter_key: 'unassigned',
        };
      });
      // Chunked multi-row INSERTs, not one round trip per target. A /16
      // scope is 65,534 targets, and issuing 65,534 sequential INSERTs
      // inside a single transaction inside an HTTP handler took long
      // enough that the request timed out and left the transaction to roll
      // back -- so creating a run over a large scope simply did not work.
      // 1,000 rows per statement keeps each statement's parameter count
      // well inside Postgres's 65,535 bound parameter limit.
      const INSERT_CHUNK_SIZE = 1_000;
      for (let offset = 0; offset < targetRows.length; offset += INSERT_CHUNK_SIZE) {
        await trx
          .insertInto('scan_run_targets')
          .values(targetRows.slice(offset, offset + INSERT_CHUNK_SIZE))
          .execute();
      }
      await appendAuditEntry(trx, {
        actorUserId: currentUser.userId,
        sessionId: currentUser.sessionId,
        sourceAddress: sourceAddressOf(request),
        action: 'scan_run.created',
        targetType: 'scan_run',
        targetId: scanRunId,
        beforeState: null,
        afterState: {
          scopeId: plan.scope_id,
          profileId: plan.profile_id,
          targetCount: plan.target_count,
        },
        outcome: 'success',
      });
    });

    // Query the real aggregate, the same way GET /scan-runs/{id} does --
    // plan.target_count is the plan's in-bounds count only, which undercounts
    // targetsTotal here since materialized scan_run_targets also includes
    // the excluded rows (254 total vs. 253 in-bounds, in one real run this
    // surfaced against). Handing back a number this response's own GET
    // wouldn't reproduce is exactly the kind of inconsistency to not ship.
    const row = await scanRunSelect(db)
      .where('scan_runs.id', '=', scanRunId)
      .executeTakeFirstOrThrow();
    const responseBody = toScanRun(row as ScanRunRow);
    await storeIdempotentResponse(deps.redis, 'createScanRun', idempotencyKey, {
      status: 202,
      body: responseBody,
    });
    return reply.code(202).header('Location', `/v1/scan-runs/${scanRunId}`).send(responseBody);
  });

  // --------------------------------------------------- ScanRun lifecycle
  /**
   * One conditional UPDATE, not a SELECT followed by an unconditional
   * UPDATE. The read-then-write version raced against the worker (which
   * moves a run to `completed`/`failed` on its own) and against a second
   * concurrent operator: both requests could read `running`, both could
   * pass the guard, and the second write would silently overwrite the
   * first -- e.g. resuming a run an instant after someone else aborted it.
   * Postgres evaluates the WHERE clause and the write atomically, so the
   * guard and the write cannot be separated.
   */
  async function transitionScanRun(
    scanRunId: string,
    allowedFrom: readonly string[],
    updates: Record<string, unknown>,
  ) {
    const updated = await db
      .updateTable('scan_runs')
      .set(updates)
      .where('id', '=', scanRunId)
      .where('status', 'in', allowedFrom as never)
      .returning('id')
      .execute();
    if (updated.length > 0) return { kind: 'ok' as const };

    // Nothing was updated: either the run does not exist, or it was not in
    // an allowed state. Distinguish the two for the caller's status code.
    const existing = await db
      .selectFrom('scan_runs')
      .select('status')
      .where('id', '=', scanRunId)
      .executeTakeFirst();
    if (!existing) return { kind: 'not_found' as const };
    return { kind: 'conflict' as const, from: existing.status };
  }

  app.post(
    '/scan-runs/:scanRunId/pause',
    { preHandler: requireSession(deps) },
    async (request, reply) => {
      const currentUser = request.currentUser!;
      if (!(await requireOperator(db, currentUser.userId))) {
        return reply
          .code(403)
          .type('application/problem+json')
          .send(problem(403, 'auth.forbidden', 'Operator role required'));
      }
      const { scanRunId } = request.params as { scanRunId: string };
      const result = await transitionScanRun(scanRunId, ['running', 'queued'], {
        status: 'paused',
        paused_at: new Date(),
      });
      if (result.kind === 'not_found') {
        return reply
          .code(404)
          .type('application/problem+json')
          .send(problem(404, 'resource.not_found', 'Scan run not found'));
      }
      if (result.kind === 'conflict') {
        return reply
          .code(409)
          .type('application/problem+json')
          .send(
            problem(
              409,
              'scan.invalid_transition',
              `Cannot pause a scan run in status ${result.from}`,
            ),
          );
      }
      await appendAuditEntry(db, {
        actorUserId: currentUser.userId,
        sessionId: currentUser.sessionId,
        sourceAddress: sourceAddressOf(request),
        action: 'scan_run.paused',
        targetType: 'scan_run',
        targetId: scanRunId,
        beforeState: null,
        afterState: null,
        outcome: 'success',
      });
      const row = await scanRunSelect(db)
        .where('scan_runs.id', '=', scanRunId)
        .executeTakeFirstOrThrow();
      return reply.code(200).send(toScanRun(row as ScanRunRow));
    },
  );

  app.post(
    '/scan-runs/:scanRunId/resume',
    { preHandler: requireSession(deps) },
    async (request, reply) => {
      const currentUser = request.currentUser!;
      if (!(await requireOperator(db, currentUser.userId))) {
        return reply
          .code(403)
          .type('application/problem+json')
          .send(problem(403, 'auth.forbidden', 'Operator role required'));
      }
      const { scanRunId } = request.params as { scanRunId: string };
      const result = await transitionScanRun(scanRunId, ['paused'], {
        status: 'running',
        paused_at: null,
      });
      if (result.kind === 'not_found') {
        return reply
          .code(404)
          .type('application/problem+json')
          .send(problem(404, 'resource.not_found', 'Scan run not found'));
      }
      if (result.kind === 'conflict') {
        return reply
          .code(409)
          .type('application/problem+json')
          .send(
            problem(
              409,
              'scan.invalid_transition',
              `Cannot resume a scan run in status ${result.from}`,
            ),
          );
      }
      await appendAuditEntry(db, {
        actorUserId: currentUser.userId,
        sessionId: currentUser.sessionId,
        sourceAddress: sourceAddressOf(request),
        action: 'scan_run.resumed',
        targetType: 'scan_run',
        targetId: scanRunId,
        beforeState: null,
        afterState: null,
        outcome: 'success',
      });
      const row = await scanRunSelect(db)
        .where('scan_runs.id', '=', scanRunId)
        .executeTakeFirstOrThrow();
      return reply.code(200).send(toScanRun(row as ScanRunRow));
    },
  );

  app.post(
    '/scan-runs/:scanRunId/abort',
    { preHandler: requireSession(deps) },
    async (request, reply) => {
      const currentUser = request.currentUser!;
      if (!(await requireOperator(db, currentUser.userId))) {
        return reply
          .code(403)
          .type('application/problem+json')
          .send(problem(403, 'auth.forbidden', 'Operator role required'));
      }
      const { scanRunId } = request.params as { scanRunId: string };
      const body = request.body as { reason?: string } | undefined;
      const result = await transitionScanRun(scanRunId, ['queued', 'running', 'paused'], {
        status: 'aborted',
        aborted_by_user_id: currentUser.userId,
        aborted_reason: body?.reason ?? null,
      });
      if (result.kind === 'not_found') {
        return reply
          .code(404)
          .type('application/problem+json')
          .send(problem(404, 'resource.not_found', 'Scan run not found'));
      }
      if (result.kind === 'conflict') {
        return reply
          .code(409)
          .type('application/problem+json')
          .send(
            problem(
              409,
              'scan.invalid_transition',
              `Cannot abort a scan run in status ${result.from}`,
            ),
          );
      }
      await appendAuditEntry(db, {
        actorUserId: currentUser.userId,
        sessionId: currentUser.sessionId,
        sourceAddress: sourceAddressOf(request),
        action: 'scan_run.aborted',
        targetType: 'scan_run',
        targetId: scanRunId,
        beforeState: null,
        afterState: { reason: body?.reason ?? null },
        outcome: 'success',
      });
      const row = await scanRunSelect(db)
        .where('scan_runs.id', '=', scanRunId)
        .executeTakeFirstOrThrow();
      return reply.code(200).send(toScanRun(row as ScanRunRow));
    },
  );

  // --------------------------------------------------------- VerificationScans
  app.post('/verification-scans', { preHandler: requireSession(deps) }, async (request, reply) => {
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
    const cached = await getIdempotentResponse(
      deps.redis,
      'createVerificationScan',
      idempotencyKey,
    );
    if (cached) return reply.code(cached.status).send(cached.body);

    const body = request.body as { issueId?: string };
    if (!body?.issueId) {
      return reply
        .code(400)
        .type('application/problem+json')
        .send(problem(400, 'validation.schema_violation', 'issueId is required'));
    }
    const issue = await db
      .selectFrom('issues')
      .selectAll()
      .where('id', '=', body.issueId)
      .executeTakeFirst();
    if (!issue) {
      return reply
        .code(400)
        .type('application/problem+json')
        .send(
          problem(400, 'validation.schema_violation', 'issueId does not reference a real issue'),
        );
    }

    // A narrowly scoped run: single target (the issue's asset's current
    // address), same profile the issue was originally found under isn't
    // tracked per-issue, so this uses the scope the issue's asset falls
    // under most recently observed in, standard/safe default otherwise --
    // simplified to the asset's current address as the sole target.
    const asset = await db
      .selectFrom('asset_address_history')
      .select('address')
      .where('asset_id', '=', issue.asset_id)
      .where('is_current', '=', true)
      .executeTakeFirst();
    if (!asset) {
      return reply
        .code(422)
        .type('application/problem+json')
        .send(
          problem(
            422,
            'scan.no_current_address',
            'This issue’s asset has no current address to verify',
          ),
        );
    }
    // SAFE-01. This used to take whichever non-superseded scope the
    // database happened to return FIRST, with no check that the address
    // being verified was actually covered by it -- which meant a
    // verification scan could probe any address in the estate, in-scope or
    // not, as long as one authorised scope existed somewhere. The scope
    // must be one that genuinely authorises THIS address.
    const candidateScopes = await db
      .selectFrom('authorized_scopes')
      .select(['id', 'cidr_ranges', 'hostnames'])
      .where('superseded_by_id', 'is', null)
      .orderBy('accepted_at', 'desc')
      .execute();
    const scope = candidateScopes.find(
      (candidate) =>
        (candidate.cidr_ranges as unknown as string[]).some((range) =>
          isIpv4InCidr(asset.address as string, range),
        ) || candidate.hostnames.includes(asset.address as string),
    );
    if (!scope) {
      return reply
        .code(422)
        .type('application/problem+json')
        .send(
          problem(
            422,
            'scan.address_not_in_scope',
            'No current authorized scope covers this asset’s address, so it cannot be re-probed',
          ),
        );
    }

    // SAFE-02 layer 1, which this endpoint skipped entirely: a verification
    // scan is still a scan, and an excluded address is excluded no matter
    // which endpoint asks for it. The hit is audited rather than silently
    // dropped, exactly as an exclusion hit on a full scan plan is.
    const applicableExclusions = await db
      .selectFrom('exclusion_rules')
      .select(['id', 'rule_type', 'value'])
      .where('is_active', '=', true)
      .where((eb) => eb.or([eb('scope_id', '=', scope.id), eb('scope_id', 'is', null)]))
      .execute();
    const exclusionHit = applicableExclusions.find(
      (rule) =>
        (rule.rule_type === 'address' && rule.value === asset.address) ||
        (rule.rule_type === 'range' && isIpv4InCidr(asset.address as string, rule.value)),
    );
    if (exclusionHit) {
      await appendAuditEntry(db, {
        actorUserId: currentUser.userId,
        sessionId: currentUser.sessionId,
        sourceAddress: sourceAddressOf(request),
        action: 'verification_scan.blocked_by_exclusion',
        targetType: 'issue',
        targetId: body.issueId,
        beforeState: null,
        afterState: { exclusionRuleId: exclusionHit.id, target: asset.address },
        outcome: 'denied',
      });
      return reply
        .code(422)
        .type('application/problem+json')
        .send(
          problem(
            422,
            'scan.target_excluded',
            'This asset’s address is covered by an active exclusion rule and must never be probed',
          ),
        );
    }

    // SAFE-03: default to the least intrusive profile that can run, never
    // whichever profile happens to be oldest. A re-check of one already
    // known finding has no business escalating intrusiveness, and a profile
    // marked requires_confirmation cannot be confirmed on this path at all.
    const profile = await db
      .selectFrom('scan_profiles')
      .select(['id', 'intrusiveness'])
      .where('requires_confirmation', '=', false)
      .orderBy(
        sql`case intrusiveness when 'passive-inventory' then 0 when 'safe' then 1 else 2 end`,
        'asc',
      )
      .orderBy('created_at', 'asc')
      .executeTakeFirst();
    if (!profile) {
      return reply
        .code(422)
        .type('application/problem+json')
        .send(
          problem(
            422,
            'scan.no_scope_or_profile',
            'No non-confirmation scan profile exists to run a verification scan under',
          ),
        );
    }

    const scanRunId = newId();
    const verificationId = newId();
    await db.transaction().execute(async (trx) => {
      const planId = newId();
      await trx
        .insertInto('scan_plan_previews')
        .values({
          id: planId,
          scope_id: scope.id,
          profile_id: profile.id,
          target_count: 1,
          estimated_packet_volume: 1,
          estimated_duration_seconds: 1,
          excluded_targets: JSON.stringify([]) as never,
          fragile_downgrades: JSON.stringify([]) as never,
          confirmed_by_user_id: currentUser.userId,
          confirmed_at: new Date(),
        })
        .execute();
      await trx
        .insertInto('scan_runs')
        .values({
          id: scanRunId,
          plan_preview_id: planId,
          scope_id: scope.id,
          profile_id: profile.id,
          initiated_by_user_id: currentUser.userId,
          status: 'queued',
          correlation_id: newId(),
        })
        .execute();
      await trx
        .insertInto('scan_run_targets')
        .values({
          id: newId(),
          scan_run_id: scanRunId,
          target_address: asset.address,
          status: 'pending',
          adapter_key: 'unassigned',
        })
        .execute();
      await trx
        .insertInto('verification_scans')
        .values({
          id: verificationId,
          issue_id: body.issueId!,
          scan_run_id: scanRunId,
          requested_by: currentUser.userId,
        })
        .execute();
      await appendAuditEntry(trx, {
        actorUserId: currentUser.userId,
        sessionId: currentUser.sessionId,
        sourceAddress: sourceAddressOf(request),
        action: 'verification_scan.created',
        targetType: 'verification_scan',
        targetId: verificationId,
        beforeState: null,
        afterState: { issueId: body.issueId, scanRunId },
        outcome: 'success',
      });
    });

    const row = await db
      .selectFrom('verification_scans')
      .selectAll()
      .where('id', '=', verificationId)
      .executeTakeFirstOrThrow();
    const responseBody = {
      id: row.id,
      issueId: row.issue_id,
      scanRunId: row.scan_run_id,
      requestedBy: row.requested_by,
      requestedAt: row.requested_at,
      outcome: row.outcome,
    };
    await storeIdempotentResponse(deps.redis, 'createVerificationScan', idempotencyKey, {
      status: 201,
      body: responseBody,
    });
    return reply.code(201).send(responseBody);
  });
}
