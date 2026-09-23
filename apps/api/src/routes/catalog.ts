import type { FastifyInstance } from 'fastify';
import { newId, DEFAULT_RISK_SCORING_WEIGHTS } from '@xenitex/domain';
import type { ApiDependencies } from '../dependencies.js';
import { appendAuditEntry } from '../audit/audit-log.js';
import { requireRole } from '../auth/capabilities.js';
import { problem, requireSession, sourceAddressOf } from './auth.js';
import { buildPage, decodeCursor, parseLimit } from '../lib/pagination.js';
import { getIdempotentResponse, storeIdempotentResponse } from '../lib/idempotency.js';
import { etagFor, ifMatchSatisfied } from '../lib/etag.js';

/**
 * The remaining operations the OpenAPI contract (packages/contracts) has
 * always declared and apps/api never implemented. GATE 2 froze that
 * specification as "the single source of truth" (2.1), and 34 of its 131
 * operations had no handler behind them — so the contract, the generated
 * client, and the mock server all described a product the real API did not
 * provide. Anything reachable from a screen 404'd; anything not yet
 * reachable was a trap for the next person to wire it up.
 */

const RISK_BANDS = ['low', 'medium', 'high', 'critical'] as const;
const ASSET_CRITICALITIES = ['low', 'medium', 'high', 'critical'] as const;

function toRiskScoringPolicy(row: {
  version: number;
  weights: unknown;
  is_active: boolean;
  created_by: string | null;
  created_at: Date | string;
}) {
  return {
    version: row.version,
    weights: row.weights,
    isActive: row.is_active,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function toSlaPolicy(row: {
  id: string;
  risk_band: string;
  asset_criticality: string;
  due_within_days: number;
  version: number;
  is_active: boolean;
}) {
  return {
    id: row.id,
    riskBand: row.risk_band,
    assetCriticality: row.asset_criticality,
    dueWithinDays: row.due_within_days,
    version: row.version,
    isActive: row.is_active,
  };
}

/**
 * Validates a client-supplied weight table against the shape
 * `computeRiskScore` actually indexes into. Without this, a PATCH omitting
 * one key writes a policy that makes every subsequent score throw (see
 * packages/domain's `requireWeight`) — better to reject the write than to
 * accept it and break scoring for every issue created afterwards.
 */
function validateRiskWeights(weights: unknown): string | null {
  if (typeof weights !== 'object' || weights === null) return 'weights must be an object';
  const w = weights as Record<string, unknown>;
  for (const scalar of [
    'knownExploitedMultiplier',
    'exploitProbabilityBaseMultiplier',
    'exploitProbabilityScale',
  ]) {
    const value = w[scalar];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      return `${scalar} must be a finite number >= 0`;
    }
  }
  const groups: Record<string, readonly string[]> = {
    exposure: ['external', 'dmz', 'internal', 'isolated', 'unknown'],
    criticality: ['critical', 'high', 'medium', 'low'],
    confidence: ['verified', 'corroborated', 'inferred'],
  };
  for (const [group, keys] of Object.entries(groups)) {
    const table = w[group];
    if (typeof table !== 'object' || table === null) return `${group} must be an object`;
    for (const key of keys) {
      const value = (table as Record<string, unknown>)[key];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        return `${group}.${key} must be a finite number >= 0`;
      }
    }
  }
  return null;
}

export async function registerCatalogRoutes(
  app: FastifyInstance,
  deps: ApiDependencies,
): Promise<void> {
  const { db } = deps;

  // ------------------------------------------------------- ScannerAdapters
  app.get('/scanner-adapters', { preHandler: requireSession(deps) }, async (_request, reply) => {
    const rows = await db
      .selectFrom('scanner_adapters')
      .selectAll()
      .orderBy('adapter_key', 'asc')
      .execute();
    return reply.code(200).send(
      rows.map((row) => ({
        adapterKey: row.adapter_key,
        version: row.version,
        fidelityRating: Number(row.fidelity_rating),
        capabilities: row.capabilities,
        isEnabled: row.is_enabled,
      })),
    );
  });

  // --------------------------------------------------- FragileDeviceRules
  app.get(
    '/fragile-device-rules',
    { preHandler: requireSession(deps) },
    async (_request, reply) => {
      const rows = await db
        .selectFrom('fragile_device_rules')
        .selectAll()
        .orderBy('device_class', 'asc')
        .execute();
      return reply.code(200).send(
        rows.map((row) => ({
          id: row.id,
          deviceClass: row.device_class,
          matchCriteria: row.match_criteria,
          isEnabled: row.is_enabled,
        })),
      );
    },
  );

  app.patch(
    '/fragile-device-rules/:ruleId',
    { preHandler: requireSession(deps) },
    async (request, reply) => {
      const currentUser = request.currentUser!;
      if (!requireRole(currentUser.role, 'operator')) {
        return reply
          .code(403)
          .type('application/problem+json')
          .send(problem(403, 'auth.forbidden', 'Operator role required'));
      }
      const { ruleId } = request.params as { ruleId: string };
      const existing = await db
        .selectFrom('fragile_device_rules')
        .selectAll()
        .where('id', '=', ruleId)
        .executeTakeFirst();
      if (!existing) {
        return reply
          .code(404)
          .type('application/problem+json')
          .send(problem(404, 'resource.not_found', 'Fragile device rule not found'));
      }
      const body = request.body as { isEnabled?: boolean };
      if (typeof body?.isEnabled !== 'boolean') {
        return reply
          .code(400)
          .type('application/problem+json')
          .send(problem(400, 'validation.schema_violation', 'isEnabled (boolean) is required'));
      }

      await db
        .updateTable('fragile_device_rules')
        .set({ is_enabled: body.isEnabled })
        .where('id', '=', ruleId)
        .execute();
      // SAFE-05: disabling a fragile-device heuristic removes a protection
      // for exactly the device classes most likely to be harmed by a scan,
      // so who did it and when is recorded whether or not anything breaks.
      await appendAuditEntry(db, {
        actorUserId: currentUser.userId,
        sessionId: currentUser.sessionId,
        sourceAddress: sourceAddressOf(request),
        action: 'fragile_device_rule.updated',
        targetType: 'fragile_device_rule',
        targetId: ruleId,
        beforeState: { isEnabled: existing.is_enabled },
        afterState: { isEnabled: body.isEnabled },
        outcome: 'success',
      });

      return reply.code(200).send({
        id: existing.id,
        deviceClass: existing.device_class,
        matchCriteria: existing.match_criteria,
        isEnabled: body.isEnabled,
      });
    },
  );

  // ---------------------------------------------------- RiskScoringPolicy
  app.get(
    '/risk-scoring-policies',
    { preHandler: requireSession(deps) },
    async (_request, reply) => {
      const rows = await db
        .selectFrom('risk_scoring_policies')
        .selectAll()
        .orderBy('version', 'desc')
        .execute();
      return reply.code(200).send(rows.map(toRiskScoringPolicy));
    },
  );

  app.get(
    '/risk-scoring-policies/active',
    { preHandler: requireSession(deps) },
    async (_request, reply) => {
      const row = await db
        .selectFrom('risk_scoring_policies')
        .selectAll()
        .where('is_active', '=', true)
        .executeTakeFirst();
      if (!row) {
        return reply
          .code(404)
          .type('application/problem+json')
          .send(problem(404, 'resource.not_found', 'No active risk scoring policy'));
      }
      return reply.code(200).send(toRiskScoringPolicy(row));
    },
  );

  app.post(
    '/risk-scoring-policies',
    { preHandler: requireSession(deps) },
    async (request, reply) => {
      const currentUser = request.currentUser!;
      if (!requireRole(currentUser.role, 'administrator')) {
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
      const cached = await getIdempotentResponse(
        deps.redis,
        'createRiskScoringPolicy',
        idempotencyKey,
      );
      if (cached) return reply.code(cached.status).send(cached.body);

      const weights = request.body;
      const invalid = validateRiskWeights(weights);
      if (invalid) {
        return reply
          .code(400)
          .type('application/problem+json')
          .send(problem(400, 'validation.schema_violation', invalid));
      }

      const latest = await db
        .selectFrom('risk_scoring_policies')
        .select('version')
        .orderBy('version', 'desc')
        .limit(1)
        .executeTakeFirst();
      const version = (latest?.version ?? 0) + 1;

      await db.transaction().execute(async (trx) => {
        // MOD-18: publishing new weights supersedes the previous policy but
        // never edits it. `uq_one_active_risk_policy` enforces exactly one
        // active row, so the old one is stood down inside the same
        // transaction that stands the new one up.
        await trx
          .updateTable('risk_scoring_policies')
          .set({ is_active: false })
          .where('is_active', '=', true)
          .execute();
        await trx
          .insertInto('risk_scoring_policies')
          .values({
            id: newId(),
            version,
            weights: JSON.stringify(weights) as never,
            is_active: true,
            created_by: currentUser.userId,
          })
          .execute();
        await appendAuditEntry(trx, {
          actorUserId: currentUser.userId,
          sessionId: currentUser.sessionId,
          sourceAddress: sourceAddressOf(request),
          action: 'risk_scoring_policy.published',
          targetType: 'risk_scoring_policy',
          targetId: String(version),
          beforeState: { activeVersion: latest?.version ?? null },
          afterState: { activeVersion: version, weights },
          outcome: 'success',
        });
      });

      const row = await db
        .selectFrom('risk_scoring_policies')
        .selectAll()
        .where('version', '=', version)
        .executeTakeFirstOrThrow();
      const responseBody = toRiskScoringPolicy(row);
      await storeIdempotentResponse(deps.redis, 'createRiskScoringPolicy', idempotencyKey, {
        status: 201,
        body: responseBody,
      });
      return reply
        .code(201)
        .header('Location', `/v1/risk-scoring-policies/${version}/recompute-status`)
        .send(responseBody);
    },
  );

  app.get(
    '/risk-scoring-policies/:version/recompute-status',
    { preHandler: requireSession(deps) },
    async (request, reply) => {
      const { version } = request.params as { version: string };
      const parsedVersion = Number.parseInt(version, 10);
      if (!Number.isInteger(parsedVersion)) {
        return reply
          .code(400)
          .type('application/problem+json')
          .send(problem(400, 'validation.schema_violation', 'version must be an integer'));
      }
      const policy = await db
        .selectFrom('risk_scoring_policies')
        .select(['version', 'created_at'])
        .where('version', '=', parsedVersion)
        .executeTakeFirst();
      if (!policy) {
        return reply
          .code(404)
          .type('application/problem+json')
          .send(problem(404, 'resource.not_found', 'Risk scoring policy version not found'));
      }

      // MOD-18's background recomputation reports progress by comparing how
      // many issues already carry this policy version against the total —
      // derived from the data itself rather than from a separate job-status
      // row that could drift out of step with what was actually rescored.
      const [rescored, total] = await Promise.all([
        db
          .selectFrom('issues')
          .select((eb) => eb.fn.countAll().as('count'))
          .where('risk_score_policy_version', '=', parsedVersion)
          .executeTakeFirstOrThrow(),
        db
          .selectFrom('issues')
          .select((eb) => eb.fn.countAll().as('count'))
          .executeTakeFirstOrThrow(),
      ]);
      const rescoredCount = Number(rescored.count);
      const totalCount = Number(total.count);

      return reply.code(200).send({
        version: policy.version,
        status: rescoredCount >= totalCount ? 'completed' : 'in_progress',
        issuesRescored: rescoredCount,
        issuesTotal: totalCount,
        startedAt: policy.created_at,
      });
    },
  );

  // --------------------------------------------------------- SlaPolicies
  app.get('/sla-policies', { preHandler: requireSession(deps) }, async (_request, reply) => {
    const rows = await db
      .selectFrom('sla_policies')
      .selectAll()
      .where('is_active', '=', true)
      .orderBy('risk_band', 'asc')
      .orderBy('asset_criticality', 'asc')
      .execute();
    return reply.code(200).send(rows.map(toSlaPolicy));
  });

  app.post('/sla-policies', { preHandler: requireSession(deps) }, async (request, reply) => {
    const currentUser = request.currentUser!;
    if (!requireRole(currentUser.role, 'administrator')) {
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
    const cached = await getIdempotentResponse(deps.redis, 'createSlaPolicyMatrix', idempotencyKey);
    if (cached) return reply.code(cached.status).send(cached.body);

    const rows = request.body as
      { riskBand?: string; assetCriticality?: string; dueWithinDays?: number }[] | undefined;
    if (!Array.isArray(rows) || rows.length === 0) {
      return reply
        .code(400)
        .type('application/problem+json')
        .send(problem(400, 'validation.schema_violation', 'A non-empty matrix array is required'));
    }
    const seen = new Set<string>();
    for (const row of rows) {
      if (
        !row.riskBand ||
        !RISK_BANDS.includes(row.riskBand as never) ||
        !row.assetCriticality ||
        !ASSET_CRITICALITIES.includes(row.assetCriticality as never) ||
        !Number.isInteger(row.dueWithinDays) ||
        (row.dueWithinDays as number) < 1
      ) {
        return reply
          .code(400)
          .type('application/problem+json')
          .send(
            problem(
              400,
              'validation.schema_violation',
              `Each row needs riskBand (${RISK_BANDS.join('|')}), assetCriticality (${ASSET_CRITICALITIES.join('|')}), and dueWithinDays >= 1`,
            ),
          );
      }
      // `uq_sla_policy_matrix` is a partial unique index over active rows;
      // a duplicated cell in the request body would violate it mid-insert
      // and roll the whole matrix back with a raw Postgres error. Caught
      // here so the operator is told which cell they duplicated.
      const cell = `${row.riskBand}/${row.assetCriticality}`;
      if (seen.has(cell)) {
        return reply
          .code(400)
          .type('application/problem+json')
          .send(
            problem(
              400,
              'validation.schema_violation',
              `Matrix contains two rows for the same cell: ${cell}`,
            ),
          );
      }
      seen.add(cell);
    }

    const latest = await db
      .selectFrom('sla_policies')
      .select('version')
      .orderBy('version', 'desc')
      .limit(1)
      .executeTakeFirst();
    const version = (latest?.version ?? 0) + 1;

    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('sla_policies')
        .set({ is_active: false })
        .where('is_active', '=', true)
        .execute();
      await trx
        .insertInto('sla_policies')
        .values(
          rows.map((row) => ({
            id: newId(),
            name: `${row.riskBand}/${row.assetCriticality}`,
            risk_band: row.riskBand!,
            asset_criticality: row.assetCriticality as never,
            due_within_days: row.dueWithinDays!,
            version,
            is_active: true,
          })),
        )
        .execute();
      await appendAuditEntry(trx, {
        actorUserId: currentUser.userId,
        sessionId: currentUser.sessionId,
        sourceAddress: sourceAddressOf(request),
        action: 'sla_policy.published',
        targetType: 'sla_policy',
        targetId: String(version),
        beforeState: { activeVersion: latest?.version ?? null },
        afterState: { activeVersion: version, rowCount: rows.length },
        outcome: 'success',
      });
    });

    const created = await db
      .selectFrom('sla_policies')
      .selectAll()
      .where('version', '=', version)
      .execute();
    const responseBody = created.map(toSlaPolicy);
    await storeIdempotentResponse(deps.redis, 'createSlaPolicyMatrix', idempotencyKey, {
      status: 201,
      body: responseBody,
    });
    return reply.code(201).send(responseBody);
  });

  // ------------------------------------------------------ Vulnerabilities
  app.get(
    '/vulnerabilities/:vulnerabilityId',
    { preHandler: requireSession(deps) },
    async (request, reply) => {
      const { vulnerabilityId } = request.params as { vulnerabilityId: string };
      const row = await db
        .selectFrom('vulnerabilities')
        .selectAll()
        .where('id', '=', vulnerabilityId)
        .executeTakeFirst();
      if (!row) {
        return reply
          .code(404)
          .type('application/problem+json')
          .send(problem(404, 'resource.not_found', 'Vulnerability not found'));
      }
      return reply.code(200).send({
        id: row.id,
        vulnIdentifier: row.vuln_identifier,
        cveIds: row.cve_ids,
        cweIds: row.cwe_ids,
        affectedCpes: row.affected_cpes,
        cvssVector: row.cvss_vector,
        cvssBaseScore: row.cvss_base_score === null ? null : Number(row.cvss_base_score),
        exploitProbability:
          row.exploit_probability === null ? null : Number(row.exploit_probability),
        knownExploited: row.known_exploited,
        knownExploitedSource: row.known_exploited_source,
        publishedAt: row.published_at,
        modifiedAt: row.modified_at,
        description: row.description,
        canonicalRemediation: row.canonical_remediation,
        dataImportId: row.data_import_id,
      });
    },
  );

  app.get(
    '/vulnerability-data-imports',
    { preHandler: requireSession(deps) },
    async (request, reply) => {
      const query = request.query as { cursor?: string; limit?: string };
      const limit = parseLimit(query.limit);
      const cursorId = query.cursor ? decodeCursor(query.cursor) : null;

      let q = db
        .selectFrom('vulnerability_data_imports')
        .selectAll()
        .orderBy('id', 'asc')
        .limit(limit + 1);
      if (cursorId) q = q.where('id', '>', cursorId);
      const rows = await q.execute();

      return reply.code(200).send(
        buildPage(rows, limit, (row) => ({
          id: row.id,
          sourceName: row.source_name,
          sourceVersion: row.source_version,
          // P2-06: the signature is recorded as provenance. It is not a
          // secret, but it is also not useful to a panel user, and
          // returning the raw value invites treating it as one — the
          // boolean answers the only question the UI actually asks.
          bundleSignaturePresent: Boolean(row.bundle_signature),
          status: row.status,
          recordCounts: row.record_counts,
          importedBy: row.imported_by,
          importedAt: row.imported_at,
          supersededById: row.superseded_by_id,
        })),
      );
    },
  );

  // ----------------------------------------------------- NotificationEvents
  app.get('/notification-events', { preHandler: requireSession(deps) }, async (request, reply) => {
    const query = request.query as { cursor?: string; limit?: string; status?: string };
    const limit = parseLimit(query.limit);
    const cursorId = query.cursor ? decodeCursor(query.cursor) : null;

    let q = db
      .selectFrom('notification_events')
      .selectAll()
      .orderBy('id', 'asc')
      .limit(limit + 1);
    if (cursorId) q = q.where('id', '>', cursorId);
    if (query.status) q = q.where('status', '=', query.status as never);
    const rows = await q.execute();

    return reply.code(200).send(
      buildPage(rows, limit, (row) => ({
        id: row.id,
        channelId: row.channel_id,
        eventType: row.event_type,
        mode: row.mode,
        payload: row.payload,
        status: row.status,
        attemptedAt: row.attempted_at,
        deliveredAt: row.delivered_at,
        error: row.error,
      })),
    );
  });

  app.delete(
    '/notification-channels/:channelId',
    { preHandler: requireSession(deps) },
    async (request, reply) => {
      const currentUser = request.currentUser!;
      if (!requireRole(currentUser.role, 'operator')) {
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

      // notification_events references this channel, and those rows are the
      // delivery record for alerts that have already fired — deleting the
      // channel must not take that history with it. Disabled rather than
      // removed, which is also what stops a DELETE from failing on the FK.
      await db
        .updateTable('notification_channels')
        .set({ is_enabled: false })
        .where('id', '=', channelId)
        .execute();
      await appendAuditEntry(db, {
        actorUserId: currentUser.userId,
        sessionId: currentUser.sessionId,
        sourceAddress: sourceAddressOf(request),
        action: 'notification_channel.disabled',
        targetType: 'notification_channel',
        targetId: channelId,
        beforeState: { isEnabled: existing.is_enabled },
        afterState: { isEnabled: false },
        outcome: 'success',
      });
      return reply.code(204).send();
    },
  );

  // ----------------------------------------------------------- AssetGroups
  app.get('/asset-groups', { preHandler: requireSession(deps) }, async (request, reply) => {
    const query = request.query as { cursor?: string; limit?: string };
    const limit = parseLimit(query.limit);
    const cursorId = query.cursor ? decodeCursor(query.cursor) : null;

    let q = db
      .selectFrom('asset_groups')
      .selectAll()
      .orderBy('id', 'asc')
      .limit(limit + 1);
    if (cursorId) q = q.where('id', '>', cursorId);
    const rows = await q.execute();

    return reply.code(200).send(
      buildPage(rows, limit, (row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        isDynamic: row.is_dynamic,
        dynamicFilter: row.dynamic_filter,
        createdBy: row.created_by,
        createdAt: row.created_at,
      })),
    );
  });

  app.post('/asset-groups', { preHandler: requireSession(deps) }, async (request, reply) => {
    const currentUser = request.currentUser!;
    if (!requireRole(currentUser.role, 'analyst')) {
      return reply
        .code(403)
        .type('application/problem+json')
        .send(problem(403, 'auth.forbidden', 'Analyst role required'));
    }
    const idempotencyKey = request.headers['idempotency-key'] as string | undefined;
    if (!idempotencyKey) {
      return reply
        .code(400)
        .type('application/problem+json')
        .send(problem(400, 'validation.schema_violation', 'Idempotency-Key header is required'));
    }
    const cached = await getIdempotentResponse(deps.redis, 'createAssetGroup', idempotencyKey);
    if (cached) return reply.code(cached.status).send(cached.body);

    const body = request.body as {
      name?: string;
      description?: string;
      isDynamic?: boolean;
      dynamicFilter?: Record<string, unknown>;
    };
    if (!body?.name || body.name.trim().length === 0) {
      return reply
        .code(400)
        .type('application/problem+json')
        .send(problem(400, 'validation.schema_violation', 'name is required'));
    }

    const groupId = newId();
    await db
      .insertInto('asset_groups')
      .values({
        id: groupId,
        name: body.name.trim(),
        description: body.description ?? null,
        is_dynamic: body.isDynamic ?? false,
        dynamic_filter: body.dynamicFilter ? (JSON.stringify(body.dynamicFilter) as never) : null,
        created_by: currentUser.userId,
      })
      .execute();
    await appendAuditEntry(db, {
      actorUserId: currentUser.userId,
      sessionId: currentUser.sessionId,
      sourceAddress: sourceAddressOf(request),
      action: 'asset_group.created',
      targetType: 'asset_group',
      targetId: groupId,
      beforeState: null,
      afterState: { name: body.name },
      outcome: 'success',
    });

    const row = await db
      .selectFrom('asset_groups')
      .selectAll()
      .where('id', '=', groupId)
      .executeTakeFirstOrThrow();
    const responseBody = {
      id: row.id,
      name: row.name,
      description: row.description,
      isDynamic: row.is_dynamic,
      dynamicFilter: row.dynamic_filter,
      createdBy: row.created_by,
      createdAt: row.created_at,
    };
    await storeIdempotentResponse(deps.redis, 'createAssetGroup', idempotencyKey, {
      status: 201,
      body: responseBody,
    });
    return reply.code(201).send(responseBody);
  });

  app.get(
    '/asset-groups/:groupId',
    { preHandler: requireSession(deps) },
    async (request, reply) => {
      const { groupId } = request.params as { groupId: string };
      const row = await db
        .selectFrom('asset_groups')
        .selectAll()
        .where('id', '=', groupId)
        .executeTakeFirst();
      if (!row) {
        return reply
          .code(404)
          .type('application/problem+json')
          .send(problem(404, 'resource.not_found', 'Asset group not found'));
      }
      const members = await db
        .selectFrom('asset_group_members')
        .select('asset_id')
        .where('asset_group_id', '=', groupId)
        .execute();
      const body = {
        id: row.id,
        name: row.name,
        description: row.description,
        isDynamic: row.is_dynamic,
        dynamicFilter: row.dynamic_filter,
        createdBy: row.created_by,
        createdAt: row.created_at,
        memberAssetIds: members.map((m) => m.asset_id),
      };
      reply.header('ETag', etagFor({ id: row.id, name: row.name, members: body.memberAssetIds }));
      return reply.code(200).send(body);
    },
  );

  app.patch(
    '/asset-groups/:groupId',
    { preHandler: requireSession(deps) },
    async (request, reply) => {
      const currentUser = request.currentUser!;
      if (!requireRole(currentUser.role, 'analyst')) {
        return reply
          .code(403)
          .type('application/problem+json')
          .send(problem(403, 'auth.forbidden', 'Analyst role required'));
      }
      const { groupId } = request.params as { groupId: string };
      const existing = await db
        .selectFrom('asset_groups')
        .selectAll()
        .where('id', '=', groupId)
        .executeTakeFirst();
      if (!existing) {
        return reply
          .code(404)
          .type('application/problem+json')
          .send(problem(404, 'resource.not_found', 'Asset group not found'));
      }
      const members = await db
        .selectFrom('asset_group_members')
        .select('asset_id')
        .where('asset_group_id', '=', groupId)
        .execute();
      const currentEtag = etagFor({
        id: existing.id,
        name: existing.name,
        members: members.map((m) => m.asset_id),
      });
      if (
        request.headers['if-match'] &&
        !ifMatchSatisfied(request.headers['if-match'], currentEtag)
      ) {
        return reply
          .code(409)
          .type('application/problem+json')
          .send(problem(409, 'resource.stale', 'This asset group changed since you loaded it'));
      }

      const body = request.body as { name?: string; description?: string | null };
      const updates: Record<string, unknown> = {};
      if (body?.name !== undefined) {
        if (!body.name || body.name.trim().length === 0) {
          return reply
            .code(400)
            .type('application/problem+json')
            .send(problem(400, 'validation.schema_violation', 'name must not be empty'));
        }
        updates.name = body.name.trim();
      }
      if (body?.description !== undefined) updates.description = body.description;
      if (Object.keys(updates).length === 0) {
        return reply
          .code(400)
          .type('application/problem+json')
          .send(problem(400, 'validation.schema_violation', 'No updatable fields were supplied'));
      }

      await db.updateTable('asset_groups').set(updates).where('id', '=', groupId).execute();
      await appendAuditEntry(db, {
        actorUserId: currentUser.userId,
        sessionId: currentUser.sessionId,
        sourceAddress: sourceAddressOf(request),
        action: 'asset_group.updated',
        targetType: 'asset_group',
        targetId: groupId,
        beforeState: { name: existing.name, description: existing.description },
        afterState: updates,
        outcome: 'success',
      });

      const row = await db
        .selectFrom('asset_groups')
        .selectAll()
        .where('id', '=', groupId)
        .executeTakeFirstOrThrow();
      return reply.code(200).send({
        id: row.id,
        name: row.name,
        description: row.description,
        isDynamic: row.is_dynamic,
        dynamicFilter: row.dynamic_filter,
        createdBy: row.created_by,
        createdAt: row.created_at,
      });
    },
  );

  app.delete(
    '/asset-groups/:groupId',
    { preHandler: requireSession(deps) },
    async (request, reply) => {
      const currentUser = request.currentUser!;
      if (!requireRole(currentUser.role, 'analyst')) {
        return reply
          .code(403)
          .type('application/problem+json')
          .send(problem(403, 'auth.forbidden', 'Analyst role required'));
      }
      const { groupId } = request.params as { groupId: string };
      const existing = await db
        .selectFrom('asset_groups')
        .select(['id', 'name'])
        .where('id', '=', groupId)
        .executeTakeFirst();
      if (!existing) {
        return reply
          .code(404)
          .type('application/problem+json')
          .send(problem(404, 'resource.not_found', 'Asset group not found'));
      }
      // ON DELETE CASCADE removes the membership rows; the assets
      // themselves are untouched — a group is a label, not a container.
      await db.deleteFrom('asset_groups').where('id', '=', groupId).execute();
      await appendAuditEntry(db, {
        actorUserId: currentUser.userId,
        sessionId: currentUser.sessionId,
        sourceAddress: sourceAddressOf(request),
        action: 'asset_group.deleted',
        targetType: 'asset_group',
        targetId: groupId,
        beforeState: { name: existing.name },
        afterState: null,
        outcome: 'success',
      });
      return reply.code(204).send();
    },
  );

  app.put(
    '/asset-groups/:groupId/members/:assetId',
    { preHandler: requireSession(deps) },
    async (request, reply) => {
      const currentUser = request.currentUser!;
      if (!requireRole(currentUser.role, 'analyst')) {
        return reply
          .code(403)
          .type('application/problem+json')
          .send(problem(403, 'auth.forbidden', 'Analyst role required'));
      }
      const { groupId, assetId } = request.params as { groupId: string; assetId: string };
      const [group, asset] = await Promise.all([
        db.selectFrom('asset_groups').select('id').where('id', '=', groupId).executeTakeFirst(),
        db.selectFrom('assets').select('id').where('id', '=', assetId).executeTakeFirst(),
      ]);
      if (!group || !asset) {
        return reply
          .code(404)
          .type('application/problem+json')
          .send(
            problem(404, 'resource.not_found', group ? 'Asset not found' : 'Asset group not found'),
          );
      }

      // PUT is idempotent by definition: adding an asset that is already a
      // member is a success, not a primary-key violation.
      await db
        .insertInto('asset_group_members')
        .values({ asset_group_id: groupId, asset_id: assetId })
        .onConflict((oc) => oc.columns(['asset_group_id', 'asset_id']).doNothing())
        .execute();
      await appendAuditEntry(db, {
        actorUserId: currentUser.userId,
        sessionId: currentUser.sessionId,
        sourceAddress: sourceAddressOf(request),
        action: 'asset_group.member_added',
        targetType: 'asset_group',
        targetId: groupId,
        beforeState: null,
        afterState: { assetId },
        outcome: 'success',
      });
      return reply.code(204).send();
    },
  );

  app.delete(
    '/asset-groups/:groupId/members/:assetId',
    { preHandler: requireSession(deps) },
    async (request, reply) => {
      const currentUser = request.currentUser!;
      if (!requireRole(currentUser.role, 'analyst')) {
        return reply
          .code(403)
          .type('application/problem+json')
          .send(problem(403, 'auth.forbidden', 'Analyst role required'));
      }
      const { groupId, assetId } = request.params as { groupId: string; assetId: string };
      await db
        .deleteFrom('asset_group_members')
        .where('asset_group_id', '=', groupId)
        .where('asset_id', '=', assetId)
        .execute();
      await appendAuditEntry(db, {
        actorUserId: currentUser.userId,
        sessionId: currentUser.sessionId,
        sourceAddress: sourceAddressOf(request),
        action: 'asset_group.member_removed',
        targetType: 'asset_group',
        targetId: groupId,
        beforeState: { assetId },
        afterState: null,
        outcome: 'success',
      });
      return reply.code(204).send();
    },
  );
}

/** Exported for the seed/test path: the shipped defaults a fresh appliance scores against. */
export const SHIPPED_RISK_WEIGHTS = DEFAULT_RISK_SCORING_WEIGHTS;
