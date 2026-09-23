import type { FastifyInstance } from 'fastify';
import { sql } from '@xenitex/db';
import { newId } from '@xenitex/domain';
import type { ApiDependencies } from '../dependencies.js';
import { appendAuditEntry } from '../audit/audit-log.js';
import { requireRole } from '../auth/capabilities.js';
import { problem, requireSession, sourceAddressOf } from './auth.js';
import { buildPage, decodeCursor, parseLimit } from '../lib/pagination.js';
import { issueSelect, toIssue, type IssueRow } from './issues.js';
import { scanRunSelect, toScanRun, type ScanRunRow } from './scans.js';
import { getIdempotentResponse, storeIdempotentResponse } from '../lib/idempotency.js';
import { etagFor } from '../lib/etag.js';

function toAssetMergeEvent(row: {
  id: string;
  survivor_asset_id: string;
  merged_asset_id: string;
  matched_identity_key_type: string | null;
  policy_version: number;
  confidence: string;
  performed_by: string | null;
  performed_at: Date | string;
  reversed_by: string | null;
  reversed_at: Date | string | null;
  reversal_reason: string | null;
}) {
  return {
    id: row.id,
    survivorAssetId: row.survivor_asset_id,
    mergedAssetId: row.merged_asset_id,
    matchedIdentityKeyType: row.matched_identity_key_type,
    policyVersion: row.policy_version,
    confidence: Number(row.confidence),
    performedBy: row.performed_by,
    performedAt: row.performed_at,
    reversedBy: row.reversed_by,
    reversedAt: row.reversed_at,
    reversalReason: row.reversal_reason,
  };
}

function mergeEventSelect(db: ApiDependencies['db']) {
  return db
    .selectFrom('asset_merge_events')
    .leftJoin(
      'asset_identity_keys',
      'asset_identity_keys.id',
      'asset_merge_events.matched_identity_key_id',
    )
    .select([
      'asset_merge_events.id',
      'asset_merge_events.survivor_asset_id',
      'asset_merge_events.merged_asset_id',
      'asset_merge_events.policy_version',
      'asset_merge_events.confidence',
      'asset_merge_events.performed_by',
      'asset_merge_events.performed_at',
      'asset_merge_events.reversed_by',
      'asset_merge_events.reversed_at',
      'asset_merge_events.reversal_reason',
      'asset_identity_keys.key_type as matched_identity_key_type',
    ]);
}

export interface AssetRow {
  id: string;
  lifecycle_state: string;
  merged_into_asset_id: string | null;
  os_inference: string | null;
  os_inference_confidence: string | null;
  owner_team: string | null;
  business_criticality: string;
  exposure_classification: string;
  tags: string[];
  is_fragile: boolean;
  first_seen: Date | string;
  last_seen: Date | string;
  risk_rating: string | null;
  risk_band: string | null;
}

interface NestedCollections {
  identityKeys: Map<string, Awaited<ReturnType<typeof selectIdentityKeys>>[number][]>;
  addresses: Map<string, Awaited<ReturnType<typeof selectAddresses>>[number][]>;
  hostnames: Map<string, Awaited<ReturnType<typeof selectHostnames>>[number][]>;
  services: Map<string, Awaited<ReturnType<typeof selectServices>>[number][]>;
}

function selectIdentityKeys(db: ApiDependencies['db'], assetIds: string[]) {
  return db
    .selectFrom('asset_identity_keys')
    .selectAll()
    .where('asset_id', 'in', assetIds)
    .execute();
}
function selectAddresses(db: ApiDependencies['db'], assetIds: string[]) {
  return db
    .selectFrom('asset_address_history')
    .selectAll()
    .where('asset_id', 'in', assetIds)
    .execute();
}
function selectHostnames(db: ApiDependencies['db'], assetIds: string[]) {
  return db
    .selectFrom('asset_hostname_history')
    .selectAll()
    .where('asset_id', 'in', assetIds)
    .execute();
}
function selectServices(db: ApiDependencies['db'], assetIds: string[]) {
  return db.selectFrom('asset_services').selectAll().where('asset_id', 'in', assetIds).execute();
}

/** Batch-fetches the four nested collections for a page of assets in one round-trip each, not N+1 per row. */
export async function loadNestedCollections(
  db: ApiDependencies['db'],
  assetIds: string[],
): Promise<NestedCollections> {
  if (assetIds.length === 0) {
    return {
      identityKeys: new Map(),
      addresses: new Map(),
      hostnames: new Map(),
      services: new Map(),
    };
  }

  const [identityKeyRows, addressRows, hostnameRows, serviceRows] = await Promise.all([
    selectIdentityKeys(db, assetIds),
    selectAddresses(db, assetIds),
    selectHostnames(db, assetIds),
    selectServices(db, assetIds),
  ]);

  const groupBy = <T extends { asset_id: string }>(rows: T[]): Map<string, T[]> => {
    const map = new Map<string, T[]>();
    for (const row of rows) {
      const list = map.get(row.asset_id) ?? [];
      list.push(row);
      map.set(row.asset_id, list);
    }
    return map;
  };

  return {
    identityKeys: groupBy(identityKeyRows),
    addresses: groupBy(addressRows),
    hostnames: groupBy(hostnameRows),
    services: groupBy(serviceRows),
  };
}

export function toAsset(row: AssetRow, nested: Awaited<ReturnType<typeof loadNestedCollections>>) {
  return {
    id: row.id,
    lifecycleState: row.lifecycle_state,
    mergedIntoAssetId: row.merged_into_asset_id,
    identityKeys: (nested.identityKeys.get(row.id) ?? []).map((k) => ({
      keyType: k.key_type,
      keyValueUntrusted: k.key_value,
      sourceObservationId: k.source_observation_id,
      confidence: Number(k.confidence),
      firstSeen: k.first_seen,
      lastSeen: k.last_seen,
      isActive: k.is_active,
    })),
    addresses: (nested.addresses.get(row.id) ?? []).map((a) => ({
      address: a.address,
      firstSeen: a.first_seen,
      lastSeen: a.last_seen,
      isCurrent: a.is_current,
    })),
    hostnames: (nested.hostnames.get(row.id) ?? []).map((h) => ({
      hostname: h.hostname,
      firstSeen: h.first_seen,
      lastSeen: h.last_seen,
      isCurrent: h.is_current,
    })),
    osInference:
      row.os_inference != null
        ? { labelUntrusted: row.os_inference, confidence: Number(row.os_inference_confidence ?? 0) }
        : null,
    services: (nested.services.get(row.id) ?? []).map((s) => ({
      port: s.port,
      protocol: s.protocol,
      serviceNameUntrusted: s.service_name_untrusted,
      productUntrusted: s.product_untrusted,
      versionUntrusted: s.version_untrusted,
      firstSeen: s.first_seen,
      lastSeen: s.last_seen,
      isCurrent: s.is_current,
    })),
    ownerTeam: row.owner_team,
    businessCriticality: row.business_criticality,
    exposureClassification: row.exposure_classification,
    tags: row.tags,
    isFragile: row.is_fragile,
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
    riskRating: row.risk_rating === null ? null : Number(row.risk_rating),
    riskBand: row.risk_band,
  };
}

export async function registerAssetRoutes(
  app: FastifyInstance,
  deps: ApiDependencies,
): Promise<void> {
  const { db, redis } = deps;

  app.get('/assets', { preHandler: requireSession(deps) }, async (request, reply) => {
    const query = request.query as {
      cursor?: string;
      limit?: string;
      lifecycleState?: string;
      criticality?: string;
      exposure?: string;
      tag?: string;
      isFragile?: string;
      q?: string;
    };
    const limit = parseLimit(query.limit);
    const cursorId = query.cursor ? decodeCursor(query.cursor) : null;

    let q = db
      .selectFrom('assets')
      .selectAll()
      .orderBy('id', 'asc')
      .limit(limit + 1);
    if (cursorId) q = q.where('id', '>', cursorId);
    if (query.lifecycleState) q = q.where('lifecycle_state', '=', query.lifecycleState as never);
    if (query.criticality) q = q.where('business_criticality', '=', query.criticality as never);
    if (query.exposure) q = q.where('exposure_classification', '=', query.exposure as never);
    if (query.tag) q = q.where('tags', '@>', [query.tag]);
    if (query.isFragile !== undefined) q = q.where('is_fragile', '=', query.isFragile === 'true');
    const rows = (await q.execute()) as AssetRow[];

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const nested = await loadNestedCollections(
      db,
      pageRows.map((r) => r.id),
    );

    return reply.code(200).send(buildPage(pageRows, limit, (row) => toAsset(row, nested)));
  });

  app.get('/assets/:assetId', { preHandler: requireSession(deps) }, async (request, reply) => {
    const { assetId } = request.params as { assetId: string };
    const row = (await db
      .selectFrom('assets')
      .selectAll()
      .where('id', '=', assetId)
      .executeTakeFirst()) as AssetRow | undefined;
    if (!row) {
      return reply
        .code(404)
        .type('application/problem+json')
        .send(problem(404, 'resource.not_found', 'Asset not found'));
    }
    const nested = await loadNestedCollections(db, [assetId]);
    const asset = toAsset(row, nested);
    return reply.code(200).header('ETag', etagFor(asset)).send(asset);
  });

  app.patch('/assets/:assetId', { preHandler: requireSession(deps) }, async (request, reply) => {
    const currentUser = request.currentUser!;
    const role = (
      await db
        .selectFrom('users')
        .select('role')
        .where('id', '=', currentUser.userId)
        .executeTakeFirstOrThrow()
    ).role;
    if (!requireRole(role, 'analyst')) {
      return reply
        .code(403)
        .type('application/problem+json')
        .send(problem(403, 'auth.forbidden', 'Analyst role required'));
    }
    const { assetId } = request.params as { assetId: string };
    const existing = (await db
      .selectFrom('assets')
      .selectAll()
      .where('id', '=', assetId)
      .executeTakeFirst()) as AssetRow | undefined;
    if (!existing) {
      return reply
        .code(404)
        .type('application/problem+json')
        .send(problem(404, 'resource.not_found', 'Asset not found'));
    }
    const existingNested = await loadNestedCollections(db, [assetId]);
    const ifMatch = request.headers['if-match'] as string | undefined;
    if (!ifMatch || ifMatch !== etagFor(toAsset(existing, existingNested))) {
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
      ownerTeam?: string | null;
      businessCriticality?: string;
      tags?: string[];
    };
    await db
      .updateTable('assets')
      .set({
        ...(body.ownerTeam !== undefined ? { owner_team: body.ownerTeam } : {}),
        ...(body.businessCriticality
          ? { business_criticality: body.businessCriticality as never }
          : {}),
        ...(body.tags ? { tags: body.tags } : {}),
        updated_at: new Date(),
      })
      .where('id', '=', assetId)
      .execute();
    await appendAuditEntry(db, {
      actorUserId: currentUser.userId,
      sessionId: currentUser.sessionId,
      sourceAddress: sourceAddressOf(request),
      action: 'asset.updated',
      targetType: 'asset',
      targetId: assetId,
      beforeState: {
        ownerTeam: existing.owner_team,
        businessCriticality: existing.business_criticality,
        tags: existing.tags,
      },
      afterState: body,
      outcome: 'success',
    });
    const updated = (await db
      .selectFrom('assets')
      .selectAll()
      .where('id', '=', assetId)
      .executeTakeFirstOrThrow()) as AssetRow;
    const nested = await loadNestedCollections(db, [assetId]);
    return reply
      .code(200)
      .header('ETag', etagFor(toAsset(updated, nested)))
      .send(toAsset(updated, nested));
  });

  app.get(
    '/assets/:assetId/issues',
    { preHandler: requireSession(deps) },
    async (request, reply) => {
      const { assetId } = request.params as { assetId: string };
      const query = request.query as { cursor?: string; limit?: string };
      const limit = parseLimit(query.limit);
      const cursorId = query.cursor ? decodeCursor(query.cursor) : null;

      let q = issueSelect(db)
        .where('issues.asset_id', '=', assetId)
        .orderBy('issues.id', 'asc')
        .limit(limit + 1);
      if (cursorId) q = q.where('issues.id', '>', cursorId);
      const rows = await q.execute();
      return reply.code(200).send(buildPage(rows as IssueRow[], limit, toIssue));
    },
  );

  app.get(
    '/assets/:assetId/scan-history',
    { preHandler: requireSession(deps) },
    async (request, reply) => {
      const { assetId } = request.params as { assetId: string };
      const query = request.query as { cursor?: string; limit?: string };
      const limit = parseLimit(query.limit);
      const cursorId = query.cursor ? decodeCursor(query.cursor) : null;

      // No direct FK from scan_run_targets to assets (it stores a free-text
      // target_address) -- resolve via the asset's current and historical
      // addresses first, as its own subquery: scanRunSelect() already joins
      // scan_run_targets once for the completion-count aggregate, and
      // joining it a second time here for address matching hits Postgres's
      // "table name specified more than once" (each join needs a distinct
      // alias, which scanRunSelect doesn't expose) -- a subquery sidesteps
      // that entirely.
      // address is inet, target_address is text -- Postgres has no inet =
      // text operator, so this needs an explicit conversion rather than a
      // plain column-to-column onRef. host() (not a bare ::text cast,
      // which keeps the netmask -- "10.0.0.5/32" never equals "10.0.0.5")
      // returns just the address portion.
      const matchingScanRunIds = db
        .selectFrom('scan_run_targets')
        .innerJoin('asset_address_history', (join) =>
          join.on(sql`host(asset_address_history.address) = scan_run_targets.target_address`),
        )
        .select('scan_run_targets.scan_run_id')
        .where('asset_address_history.asset_id', '=', assetId)
        .distinct();

      let q = scanRunSelect(db)
        .where('scan_runs.id', 'in', matchingScanRunIds)
        .orderBy('scan_runs.id', 'asc')
        .limit(limit + 1);
      if (cursorId) q = q.where('scan_runs.id', '>', cursorId);
      const rows = await q.execute();
      return reply.code(200).send(buildPage(rows as ScanRunRow[], limit, toScanRun));
    },
  );

  app.get(
    '/asset-merge-candidates',
    { preHandler: requireSession(deps) },
    async (request, reply) => {
      const query = request.query as { cursor?: string; limit?: string };
      const limit = parseLimit(query.limit);
      const cursorId = query.cursor ? decodeCursor(query.cursor) : null;

      // MOD-06: "awaiting operator review" reads as unreversed merges,
      // lowest confidence first -- matching the index this table already
      // has (idx_asset_merge_events_pending_review), since every row here
      // is an already-performed merge (performed_at is never null) and
      // there is no separate "not yet merged" candidate state in the
      // schema for the identity-resolution pipeline (unbuilt) to populate.
      let q = mergeEventSelect(db)
        .where('asset_merge_events.reversed_at', 'is', null)
        .orderBy('asset_merge_events.confidence', 'asc')
        .orderBy('asset_merge_events.id', 'asc')
        .limit(limit + 1);
      if (cursorId) q = q.where('asset_merge_events.id', '>', cursorId);
      const rows = await q.execute();
      return reply.code(200).send(buildPage(rows, limit, toAssetMergeEvent));
    },
  );

  app.post('/asset-merges', { preHandler: requireSession(deps) }, async (request, reply) => {
    const currentUser = request.currentUser!;
    const role = (
      await db
        .selectFrom('users')
        .select('role')
        .where('id', '=', currentUser.userId)
        .executeTakeFirstOrThrow()
    ).role;
    if (!requireRole(role, 'analyst')) {
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
    const cached = await getIdempotentResponse(redis, 'createAssetMerge', idempotencyKey);
    if (cached) return reply.code(cached.status).send(cached.body);

    const body = request.body as { survivorAssetId?: string; mergedAssetId?: string };
    if (!body?.survivorAssetId || !body.mergedAssetId) {
      return reply
        .code(400)
        .type('application/problem+json')
        .send(
          problem(
            400,
            'validation.schema_violation',
            'survivorAssetId and mergedAssetId are required',
          ),
        );
    }
    if (body.survivorAssetId === body.mergedAssetId) {
      return reply
        .code(400)
        .type('application/problem+json')
        .send(
          problem(
            400,
            'validation.schema_violation',
            'survivorAssetId and mergedAssetId must differ',
          ),
        );
    }
    const [survivor, merged] = await Promise.all([
      db
        .selectFrom('assets')
        .select('id')
        .where('id', '=', body.survivorAssetId)
        .executeTakeFirst(),
      db.selectFrom('assets').select('id').where('id', '=', body.mergedAssetId).executeTakeFirst(),
    ]);
    if (!survivor || !merged) {
      return reply
        .code(400)
        .type('application/problem+json')
        .send(
          problem(
            400,
            'validation.schema_violation',
            'survivorAssetId and mergedAssetId must reference real assets',
          ),
        );
    }
    const activePolicy = await db
      .selectFrom('identity_resolution_policies')
      .select('version')
      .where('is_active', '=', true)
      .executeTakeFirstOrThrow();

    const survivorAssetId = body.survivorAssetId;
    const mergedAssetId = body.mergedAssetId;
    const eventId = newId();
    await db.transaction().execute(async (trx) => {
      // MOD-06: the merge itself -- marking the losing asset merged and
      // pointing it at the survivor. Full data consolidation (repointing
      // issues/observations at the survivor asset) is a larger piece of
      // the identity-resolution pipeline not yet built; this intentionally
      // does not silently claim to do more than it does.
      await trx
        .updateTable('assets')
        .set({
          lifecycle_state: 'merged',
          merged_into_asset_id: survivorAssetId,
          updated_at: new Date(),
        })
        .where('id', '=', mergedAssetId)
        .execute();
      await trx
        .insertInto('asset_merge_events')
        .values({
          id: eventId,
          survivor_asset_id: survivorAssetId,
          merged_asset_id: mergedAssetId,
          policy_version: activePolicy.version,
          confidence: 1, // operator-confirmed merge (this endpoint), not an automated low-confidence suggestion
          performed_by: currentUser.userId,
        })
        .execute();
      await appendAuditEntry(trx, {
        actorUserId: currentUser.userId,
        sessionId: currentUser.sessionId,
        sourceAddress: sourceAddressOf(request),
        action: 'asset.merged',
        targetType: 'asset_merge_event',
        targetId: eventId,
        beforeState: null,
        afterState: { survivorAssetId, mergedAssetId },
        outcome: 'success',
      });
    });

    const row = await mergeEventSelect(db)
      .where('asset_merge_events.id', '=', eventId)
      .executeTakeFirstOrThrow();
    const responseBody = toAssetMergeEvent(row);
    await storeIdempotentResponse(redis, 'createAssetMerge', idempotencyKey, {
      status: 201,
      body: responseBody,
    });
    return reply.code(201).send(responseBody);
  });

  app.post(
    '/asset-merge-events/:eventId/reverse',
    { preHandler: requireSession(deps) },
    async (request, reply) => {
      const currentUser = request.currentUser!;
      const role = (
        await db
          .selectFrom('users')
          .select('role')
          .where('id', '=', currentUser.userId)
          .executeTakeFirstOrThrow()
      ).role;
      if (!requireRole(role, 'analyst')) {
        return reply
          .code(403)
          .type('application/problem+json')
          .send(problem(403, 'auth.forbidden', 'Analyst role required'));
      }
      const { eventId } = request.params as { eventId: string };
      const existing = await db
        .selectFrom('asset_merge_events')
        .selectAll()
        .where('id', '=', eventId)
        .executeTakeFirst();
      if (!existing) {
        return reply
          .code(404)
          .type('application/problem+json')
          .send(problem(404, 'resource.not_found', 'Merge event not found'));
      }
      const body = request.body as { reason?: string };
      if (!body?.reason) {
        return reply
          .code(400)
          .type('application/problem+json')
          .send(problem(400, 'validation.schema_violation', 'reason is required'));
      }
      if (existing.reversed_at) {
        return reply
          .code(422)
          .type('application/problem+json')
          .send(
            problem(422, 'asset.merge_already_reversed', 'This merge has already been reversed'),
          );
      }

      await db.transaction().execute(async (trx) => {
        // MOD-06: restores the merged asset to active, keeps its history --
        // the merge event row itself is never deleted (audit trail).
        await trx
          .updateTable('assets')
          .set({ lifecycle_state: 'active', merged_into_asset_id: null, updated_at: new Date() })
          .where('id', '=', existing.merged_asset_id)
          .execute();
        await trx
          .updateTable('asset_merge_events')
          .set({
            reversed_by: currentUser.userId,
            reversed_at: new Date(),
            reversal_reason: body.reason,
          })
          .where('id', '=', eventId)
          .execute();
        await appendAuditEntry(trx, {
          actorUserId: currentUser.userId,
          sessionId: currentUser.sessionId,
          sourceAddress: sourceAddressOf(request),
          action: 'asset.merge_reversed',
          targetType: 'asset_merge_event',
          targetId: eventId,
          beforeState: null,
          afterState: { reason: body.reason },
          outcome: 'success',
        });
      });

      const row = await mergeEventSelect(db)
        .where('asset_merge_events.id', '=', eventId)
        .executeTakeFirstOrThrow();
      return reply.code(200).send(toAssetMergeEvent(row));
    },
  );
}
