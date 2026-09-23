import type { FastifyInstance } from 'fastify';
import { sql } from '@xenitex/db';
import { newId } from '@xenitex/domain';
import type { ApiDependencies } from '../dependencies.js';
import { appendAuditEntry } from '../audit/audit-log.js';
import { etagFor, ifMatchSatisfied } from '../lib/etag.js';
import { getIdempotentResponse, storeIdempotentResponse } from '../lib/idempotency.js';
import { requireRole } from '../auth/capabilities.js';
import { problem, requireSession, sourceAddressOf } from './auth.js';
import { encodeCursor, decodeCursor, parseLimit } from '../lib/pagination.js';
// assets.ts imports issueSelect/toIssue back from this file — both sides
// only use function/type exports, never a top-level value, so the ESM
// circular import resolves fine (verified: build and runtime both work).
import { loadNestedCollections, toAsset, type AssetRow } from './assets.js';

export interface IssueRow {
  id: string;
  fingerprint: string;
  fingerprint_version: number;
  asset_id: string;
  vulnerability_id: string | null;
  port: number | null;
  protocol: string | null;
  service_untrusted: string | null;
  product_untrusted: string | null;
  version_untrusted: string | null;
  severity: string;
  risk_score: string;
  risk_score_policy_version: number;
  confidence: string;
  confidence_label: string;
  state: string;
  owner_user_id: string | null;
  due_date: Date | string | null;
  exception_id: string | null;
  first_seen: Date | string;
  last_seen: Date | string;
  last_verified_at: Date | string | null;
  cve_ids: string[] | null;
  vuln_identifier: string | null;
  updated_at: Date | string;
  match_explanation: string | null;
  match_reasons: string[] | null;
}

/**
 * MOD-10's lifecycle, as a machine rather than a flat allowlist. The
 * previous check only validated that `toState` was a manually settable
 * value — it never looked at the state the issue was actually in, so
 * `new -> mitigated` (claiming a fix for something nobody had triaged) and
 * `false_positive -> mitigated` (quietly un-dismissing a finding without
 * the reopen notice MOD-11 requires) both succeeded and were recorded in
 * issue_state_history as if they were legitimate.
 *
 * `verified_resolved` appears only as a SOURCE here: MOD-13 makes it
 * system-only, set by a verification scan result in apps/worker, never by
 * this endpoint.
 */
const MANUAL_TRANSITIONS: Record<string, readonly string[]> = {
  new: ['triaged', 'in_progress', 'false_positive'],
  triaged: ['in_progress', 'mitigated', 'false_positive'],
  in_progress: ['triaged', 'mitigated', 'false_positive'],
  mitigated: ['in_progress', 'reopened', 'false_positive'],
  reopened: ['triaged', 'in_progress', 'false_positive'],
  verified_resolved: ['reopened'],
  false_positive: ['reopened'],
  risk_accepted: ['reopened'],
};

/** The representation `GET /issues/{id}` hashes into its ETag, and the same one every writer re-checks against. */
export function issueConcurrencyToken(row: { state: string; updated_at: Date | string }): string {
  return etagFor({ state: row.state, updatedAt: new Date(row.updated_at).toISOString() });
}

export function issueSelect(db: ApiDependencies['db']) {
  return db
    .selectFrom('issues')
    .leftJoin('vulnerabilities', 'vulnerabilities.id', 'issues.vulnerability_id')
    .select([
      'issues.id',
      'issues.fingerprint',
      'issues.fingerprint_version',
      'issues.asset_id',
      'issues.vulnerability_id',
      'issues.port',
      'issues.protocol',
      'issues.service_untrusted',
      'issues.product_untrusted',
      'issues.version_untrusted',
      'issues.severity',
      'issues.risk_score',
      'issues.risk_score_policy_version',
      'issues.confidence',
      'issues.confidence_label',
      'issues.match_explanation',
      'issues.match_reasons',
      'issues.state',
      'issues.owner_user_id',
      'issues.due_date',
      'issues.exception_id',
      'issues.first_seen',
      'issues.last_seen',
      'issues.last_verified_at',
      // Not returned in the body — it is the mutation counter the ETag
      // (issueConcurrencyToken) is derived from, so If-Match works.
      'issues.updated_at',
      'vulnerabilities.cve_ids',
      // The `vulnerabilities` table has no `title` column (contract/schema
      // drift -- Vulnerability.title's "first-party catalogue content"
      // never got a real column in 0001_init.up.sql). vuln_identifier
      // (the CVE/advisory id) is the closest honest stand-in until that's
      // added properly.
      'vulnerabilities.vuln_identifier',
    ]);
}

export function toIssue(row: IssueRow) {
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    fingerprintVersion: row.fingerprint_version,
    assetId: row.asset_id,
    title: row.vuln_identifier ?? undefined,
    primaryCveId: row.cve_ids?.[0] ?? null,
    vulnerabilityId: row.vulnerability_id,
    port: row.port,
    protocol: row.protocol,
    serviceUntrusted: row.service_untrusted,
    productUntrusted: row.product_untrusted,
    versionUntrusted: row.version_untrusted,
    severity: row.severity,
    riskScore: Number(row.risk_score),
    riskScorePolicyVersion: row.risk_score_policy_version,
    confidence: Number(row.confidence),
    confidenceLabel: row.confidence_label,
    matchExplanation: row.match_explanation,
    matchReasons: row.match_reasons ?? [],
    state: row.state,
    contributingObservationIds: [] as string[],
    ownerUserId: row.owner_user_id,
    dueDate: row.due_date,
    exceptionId: row.exception_id,
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
    lastVerifiedAt: row.last_verified_at,
  };
}

interface VulnerabilityRow {
  id: string;
  vuln_identifier: string;
  cve_ids: string[];
  cwe_ids: string[];
  affected_cpes: unknown;
  cvss_vector: string | null;
  cvss_version: string | null;
  cvss_base_score: string | null;
  exploit_probability: string | null;
  known_exploited: boolean;
  known_exploited_source: string | null;
  published_at: Date | string | null;
  modified_at: Date | string | null;
  description: string | null;
  canonical_remediation: string | null;
  data_import_id: string;
}

function toVulnerability(row: VulnerabilityRow) {
  return {
    id: row.id,
    vulnIdentifier: row.vuln_identifier,
    cveIds: row.cve_ids,
    cweIds: row.cwe_ids,
    affectedCpes: row.affected_cpes,
    cvssVector: row.cvss_vector,
    cvssVersion: row.cvss_version,
    cvssBaseScore: row.cvss_base_score === null ? null : Number(row.cvss_base_score),
    exploitProbability: row.exploit_probability === null ? null : Number(row.exploit_probability),
    knownExploited: row.known_exploited,
    knownExploitedSource: row.known_exploited_source,
    publishedAt: row.published_at,
    modifiedAt: row.modified_at,
    description: row.description,
    canonicalRemediation: row.canonical_remediation,
    dataImportId: row.data_import_id,
  };
}

interface ObservationRow {
  id: string;
  scan_run_id: string;
  adapter_key: string;
  adapter_version: string;
  raw_artifact_id: string;
  target_address: string;
  target_port: number | null;
  target_protocol: string | null;
  resolved_asset_id: string | null;
  extracted_attributes: unknown;
  untrusted_evidence: unknown;
  observed_at: Date | string;
}

function toObservation(row: ObservationRow) {
  return {
    id: row.id,
    scanRunId: row.scan_run_id,
    scannerAdapterKey: row.adapter_key,
    scannerAdapterVersion: row.adapter_version,
    rawArtifactId: row.raw_artifact_id,
    targetAddress: row.target_address,
    targetPort: row.target_port,
    targetProtocol: row.target_protocol,
    resolvedAssetId: row.resolved_asset_id,
    extractedAttributes: row.extracted_attributes,
    untrustedEvidence: row.untrusted_evidence,
    observedAt: row.observed_at,
  };
}

const SORT_COLUMNS: Record<string, string> = {
  riskScore: 'risk_score',
  dueDate: 'due_date',
  firstSeen: 'first_seen',
  lastSeen: 'last_seen',
};

function decodeCompositeCursor(cursor: string): { sortValue: string; id: string } | null {
  const decoded = decodeCursor(cursor);
  if (!decoded) return null;
  try {
    const parsed = JSON.parse(decoded) as { sortValue: string; id: string };
    return typeof parsed.sortValue === 'string' && typeof parsed.id === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

function encodeCompositeCursor(sortValue: unknown, id: string): string {
  return encodeCursor(JSON.stringify({ sortValue: String(sortValue), id }));
}

export async function registerIssueRoutes(
  app: FastifyInstance,
  deps: ApiDependencies,
): Promise<void> {
  const { db } = deps;

  app.get('/issues', { preHandler: requireSession(deps) }, async (request, reply) => {
    const query = request.query as {
      cursor?: string;
      limit?: string;
      state?: string | string[];
      confidenceFloor?: string;
      minRiskScore?: string;
      assetId?: string;
      ownerUserId?: string;
      overdue?: string;
      sort?: string;
    };
    const limit = parseLimit(query.limit);
    const sortKey = query.sort && query.sort in SORT_COLUMNS ? query.sort : 'riskScore';
    const sortColumn = SORT_COLUMNS[sortKey]!;
    const confidenceFloor =
      query.confidenceFloor !== undefined ? Number(query.confidenceFloor) : 0.4;

    let q = issueSelect(db).where('issues.confidence', '>=', confidenceFloor.toString());

    const states = Array.isArray(query.state) ? query.state : query.state ? [query.state] : [];
    if (states.length > 0) q = q.where('issues.state', 'in', states as never[]);
    if (query.minRiskScore !== undefined) {
      q = q.where('issues.risk_score', '>=', query.minRiskScore);
    }
    if (query.assetId) q = q.where('issues.asset_id', '=', query.assetId);
    if (query.ownerUserId) q = q.where('issues.owner_user_id', '=', query.ownerUserId);
    if (query.overdue === 'true') {
      q = q.where('issues.due_date', 'is not', null).where('issues.due_date', '<', new Date());
    }

    const descending = sortKey !== 'dueDate';
    q = q
      .orderBy(sql.ref(`issues.${sortColumn}`), descending ? 'desc' : 'asc')
      .orderBy('issues.id', 'asc');

    const cursor = query.cursor ? decodeCompositeCursor(query.cursor) : null;
    if (cursor) {
      const op = descending ? '<' : '>';
      q = q.where((eb) =>
        eb.or([
          eb(sql.ref(`issues.${sortColumn}`), op, cursor.sortValue),
          eb.and([
            eb(sql.ref(`issues.${sortColumn}`), '=', cursor.sortValue),
            eb('issues.id', '>', cursor.id),
          ]),
        ]),
      );
    }

    const rows = await q.limit(limit + 1).execute();
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const lastRow = pageRows.at(-1) as (IssueRow & Record<string, unknown>) | undefined;
    const sortColumnKey = sortColumn as keyof IssueRow;

    return reply.code(200).send({
      items: pageRows.map((row) => toIssue(row as IssueRow)),
      nextCursor:
        hasMore && lastRow ? encodeCompositeCursor(lastRow[sortColumnKey], lastRow.id) : null,
    });
  });

  app.get('/issues/:issueId', { preHandler: requireSession(deps) }, async (request, reply) => {
    const { issueId } = request.params as { issueId: string };
    const row = await issueSelect(db).where('issues.id', '=', issueId).executeTakeFirst();
    if (!row) {
      return reply
        .code(404)
        .type('application/problem+json')
        .send(problem(404, 'resource.not_found', 'Issue not found'));
    }
    const issueRow = row as IssueRow;
    const observationIdRows = await db
      .selectFrom('issue_observations')
      .select('observation_id')
      .where('issue_id', '=', issueId)
      .execute();
    const observationIds = observationIdRows.map((r) => r.observation_id);

    const issue = toIssue(issueRow);
    issue.contributingObservationIds = observationIds;

    // MOD-21/IssueDetail: every finding here is inspectable, never presented
    // without its evidence — asset/vulnerability/observations/breakdown are
    // all required fields on this schema (packages/contracts/src/openapi.yaml),
    // not optional extras.
    const assetRow = (await db
      .selectFrom('assets')
      .selectAll()
      .where('id', '=', issueRow.asset_id)
      .executeTakeFirstOrThrow()) as AssetRow;
    const nested = await loadNestedCollections(db, [assetRow.id]);
    const asset = toAsset(assetRow, nested);

    const vulnerabilityRow = issueRow.vulnerability_id
      ? ((await db
          .selectFrom('vulnerabilities')
          .selectAll()
          .where('id', '=', issueRow.vulnerability_id)
          .executeTakeFirst()) as VulnerabilityRow | undefined)
      : undefined;
    const vulnerability = vulnerabilityRow ? toVulnerability(vulnerabilityRow) : null;

    const observationRows =
      observationIds.length > 0
        ? ((await db
            .selectFrom('observations')
            .leftJoin('scanner_adapters', 'scanner_adapters.id', 'observations.scanner_adapter_id')
            .select([
              'observations.id',
              'observations.scan_run_id',
              'scanner_adapters.adapter_key',
              'scanner_adapters.version as adapter_version',
              'observations.raw_artifact_id',
              'observations.target_address',
              'observations.target_port',
              'observations.target_protocol',
              'observations.resolved_asset_id',
              'observations.extracted_attributes',
              'observations.untrusted_evidence',
              'observations.observed_at',
            ])
            .where('observations.id', 'in', observationIds)
            .execute()) as ObservationRow[])
        : [];
    const observations = observationRows.map(toObservation);

    const latestSnapshot = await db
      .selectFrom('issue_risk_score_snapshots')
      .select('factor_breakdown')
      .where('issue_id', '=', issueId)
      .orderBy('computed_at', 'desc')
      .limit(1)
      .executeTakeFirst();
    const riskScoreBreakdown = latestSnapshot?.factor_breakdown ?? [];

    // EXT-03/4.7: the real deterministic guidance engine isn't built yet —
    // remediation_guidance stays empty in every real deployment today, so
    // this always resolves to null (the schema's honest "we don't have
    // this yet" state), never a fabricated recommendation.
    let remediationGuidance = null;
    if (vulnerabilityRow) {
      const guidanceRow = await db
        .selectFrom('remediation_guidance')
        .selectAll()
        .where('match_type', '=', 'cve')
        .where(
          'match_value',
          'in',
          vulnerabilityRow.cve_ids.length > 0 ? vulnerabilityRow.cve_ids : [''],
        )
        .executeTakeFirst();
      if (guidanceRow) {
        remediationGuidance = {
          priorityRationale: guidanceRow.priority_rationale,
          remediationSteps: guidanceRow.remediation_steps,
          references: guidanceRow.references ?? [],
        };
      }
    }

    // ADR 0006 / MOD-13: the panel reads this header and refuses to enable
    // any lifecycle action without it. It was never sent, so every triage
    // button in the issue detail panel was inert — the click handler took
    // its `if (!etag) return;` branch and nothing happened, with no error.
    reply.header('ETag', issueConcurrencyToken(issueRow));
    return reply.code(200).send({
      ...issue,
      asset,
      vulnerability,
      observations,
      riskScoreBreakdown,
      remediationGuidance,
    });
  });

  app.get(
    '/issues/:issueId/history',
    { preHandler: requireSession(deps) },
    async (request, reply) => {
      const { issueId } = request.params as { issueId: string };
      const rows = await db
        .selectFrom('issue_state_history')
        .selectAll()
        .where('issue_id', '=', issueId)
        .orderBy('transitioned_at', 'asc')
        .execute();
      return reply.code(200).send(
        rows.map((row) => ({
          id: row.id,
          issueId: row.issue_id,
          fromState: row.from_state,
          toState: row.to_state,
          actorUserId: row.actor_user_id,
          reasonCode: row.reason_code,
          justification: row.justification,
          verificationScanId: row.verification_scan_id,
          transitionedAt: row.transitioned_at,
        })),
      );
    },
  );

  app.post(
    '/issues/:issueId/transitions',
    { preHandler: requireSession(deps) },
    async (request, reply) => {
      const currentUser = request.currentUser!;
      const actualRole = (
        await db
          .selectFrom('users')
          .select('role')
          .where('id', '=', currentUser.userId)
          .executeTakeFirstOrThrow()
      ).role;
      if (!requireRole(actualRole, 'analyst')) {
        return reply
          .code(403)
          .type('application/problem+json')
          .send(problem(403, 'auth.forbidden', 'Analyst role required'));
      }
      const { issueId } = request.params as { issueId: string };
      const issue = await db
        .selectFrom('issues')
        .select(['id', 'state', 'updated_at'])
        .where('id', '=', issueId)
        .executeTakeFirst();
      if (!issue) {
        return reply
          .code(404)
          .type('application/problem+json')
          .send(problem(404, 'resource.not_found', 'Issue not found'));
      }
      // ADR 0006: the contract marks If-Match required on this operation
      // and the panel sends it; the server accepted the write regardless,
      // so two analysts triaging the same issue from two stale views both
      // succeeded and the later one silently won.
      const currentEtag = issueConcurrencyToken(issue);
      if (!ifMatchSatisfied(request.headers['if-match'], currentEtag)) {
        // 428 when the client never sent a validator at all (it must, and
        // retrying the identical request will not help); 409 when it sent
        // one that no longer matches (reload and re-apply will).
        const detail = request.headers['if-match']
          ? problem(
              409,
              'resource.stale',
              'This issue changed since you loaded it',
              'Reload the issue and re-apply your change.',
            )
          : problem(
              428,
              'resource.if_match_required',
              'An If-Match header carrying the current ETag is required',
            );
        return reply.code(detail.status).type('application/problem+json').send(detail);
      }
      const body = request.body as {
        toState?: string;
        reasonCode?: string;
        justification?: string;
      };
      const allowedStates = ['triaged', 'in_progress', 'mitigated', 'reopened', 'false_positive'];
      if (!body?.toState || !allowedStates.includes(body.toState)) {
        // MOD-13: verified_resolved is system-only, never a manual transition.
        // risk_accepted (MOD-12) requires an approver distinct from the
        // requester and a mandatory expiry -- neither of which this bare
        // {toState} request carries, so it must go through
        // POST /exceptions -> POST /exceptions/{id}/approve instead of
        // being settable directly here.
        const code =
          body?.toState === 'verified_resolved'
            ? 'issue.system_only_transition'
            : body?.toState === 'risk_accepted'
              ? 'issue.use_exception_workflow'
              : 'validation.schema_violation';
        const detail =
          body?.toState === 'verified_resolved'
            ? 'verified_resolved is set only by a verification scan result'
            : body?.toState === 'risk_accepted'
              ? 'risk_accepted requires the exceptions workflow (POST /exceptions), not a direct transition'
              : 'toState must be one of triaged, in_progress, mitigated, reopened, false_positive';
        return reply
          .code(400)
          .type('application/problem+json')
          .send(problem(400, code, detail));
      }
      if (body.toState === 'false_positive' && (!body.reasonCode || !body.justification)) {
        return reply
          .code(400)
          .type('application/problem+json')
          .send(
            problem(
              400,
              'validation.schema_violation',
              'reasonCode and justification are required when toState is false_positive',
            ),
          );
      }

      // MOD-10: the transition must be legal FROM the state the issue is
      // actually in, not merely a legal state to be in.
      if (!(MANUAL_TRANSITIONS[issue.state] ?? []).includes(body.toState)) {
        return reply
          .code(409)
          .type('application/problem+json')
          .send(
            problem(
              409,
              'issue.invalid_transition',
              `An issue in state '${issue.state}' cannot move to '${body.toState}'`,
              `Allowed from '${issue.state}': ${(MANUAL_TRANSITIONS[issue.state] ?? []).join(', ') || 'none'}.`,
            ),
          );
      }

      const historyId = newId();
      await db.transaction().execute(async (trx) => {
        await trx
          .insertInto('issue_state_history')
          .values({
            id: historyId,
            issue_id: issueId,
            from_state: issue.state,
            to_state: body.toState as never,
            actor_user_id: currentUser.userId,
            reason_code: body.reasonCode ?? null,
            justification: body.justification ?? null,
          })
          .execute();
        await trx
          .updateTable('issues')
          .set({ state: body.toState as never, updated_at: new Date() })
          .where('id', '=', issueId)
          .execute();
        await appendAuditEntry(trx, {
          actorUserId: currentUser.userId,
          sessionId: currentUser.sessionId,
          sourceAddress: sourceAddressOf(request),
          action: 'issue.transitioned',
          targetType: 'issue',
          targetId: issueId,
          beforeState: { state: issue.state },
          afterState: { state: body.toState },
          outcome: 'success',
        });
      });

      const updated = (await issueSelect(db)
        .where('issues.id', '=', issueId)
        .executeTakeFirstOrThrow()) as IssueRow;
      reply.header('ETag', issueConcurrencyToken(updated));
      return reply.code(200).send(toIssue(updated));
    },
  );

  /**
   * P1-11's bulk triage. Documented in the contract from the start and
   * never implemented, so the issues screen could only ever be worked one
   * row at a time — which for a list measured in tens of thousands
   * (PERF-01) is the difference between a usable triage queue and an
   * unusable one.
   *
   * Per-issue outcomes, never all-or-nothing: one stale ETag or one
   * illegal transition in a 500-item selection must not discard the other
   * 499 decisions the analyst just made.
   */
  app.post(
    '/issues/bulk-transitions',
    { preHandler: requireSession(deps) },
    async (request, reply) => {
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
      const cached = await getIdempotentResponse(
        deps.redis,
        'bulkTransitionIssues',
        idempotencyKey,
      );
      if (cached) return reply.code(cached.status).send(cached.body);

      const body = request.body as {
        issueIds?: string[];
        transition?: { toState?: string; reasonCode?: string; justification?: string };
      };
      const issueIds = body?.issueIds ?? [];
      const toState = body?.transition?.toState;
      const allowedStates = ['triaged', 'in_progress', 'mitigated', 'reopened', 'false_positive'];

      if (issueIds.length === 0 || issueIds.length > 500) {
        return reply
          .code(400)
          .type('application/problem+json')
          .send(
            problem(
              400,
              'validation.schema_violation',
              'issueIds must contain between 1 and 500 ids',
            ),
          );
      }
      if (!toState || !allowedStates.includes(toState)) {
        return reply
          .code(400)
          .type('application/problem+json')
          .send(
            problem(
              400,
              'validation.schema_violation',
              `transition.toState must be one of: ${allowedStates.join(', ')}`,
            ),
          );
      }
      if (
        toState === 'false_positive' &&
        (!body.transition?.reasonCode || !body.transition?.justification)
      ) {
        // MOD-11 applies per issue, in bulk exactly as it does singly — a
        // reason and a justification are required, and "I selected 400 rows"
        // is not an exemption from recording why.
        return reply
          .code(400)
          .type('application/problem+json')
          .send(
            problem(
              400,
              'validation.schema_violation',
              'reasonCode and justification are required when transition.toState is false_positive',
            ),
          );
      }

      const results: { issueId: string; outcome: 'applied' | 'failed'; problem?: unknown }[] = [];
      // De-duplicated: the same id twice in one request must not produce two
      // history rows for one decision.
      for (const issueId of [...new Set(issueIds)]) {
        const issue = await db
          .selectFrom('issues')
          .select(['id', 'state'])
          .where('id', '=', issueId)
          .executeTakeFirst();
        if (!issue) {
          results.push({
            issueId,
            outcome: 'failed',
            problem: problem(404, 'resource.not_found', 'Issue not found'),
          });
          continue;
        }
        if (!(MANUAL_TRANSITIONS[issue.state] ?? []).includes(toState)) {
          results.push({
            issueId,
            outcome: 'failed',
            problem: problem(
              409,
              'issue.invalid_transition',
              `An issue in state '${issue.state}' cannot move to '${toState}'`,
            ),
          });
          continue;
        }

        await db.transaction().execute(async (trx) => {
          await trx
            .insertInto('issue_state_history')
            .values({
              id: newId(),
              issue_id: issueId,
              from_state: issue.state,
              to_state: toState as never,
              actor_user_id: currentUser.userId,
              reason_code: body.transition?.reasonCode ?? null,
              justification: body.transition?.justification ?? null,
            })
            .execute();
          await trx
            .updateTable('issues')
            .set({ state: toState as never, updated_at: new Date() })
            .where('id', '=', issueId)
            .execute();
          await appendAuditEntry(trx, {
            actorUserId: currentUser.userId,
            sessionId: currentUser.sessionId,
            sourceAddress: sourceAddressOf(request),
            action: 'issue.transitioned',
            targetType: 'issue',
            targetId: issueId,
            beforeState: { state: issue.state },
            afterState: { state: toState, bulk: true },
            outcome: 'success',
          });
        });
        results.push({ issueId, outcome: 'applied' });
      }

      const responseBody = { results };
      await storeIdempotentResponse(deps.redis, 'bulkTransitionIssues', idempotencyKey, {
        status: 200,
        body: responseBody,
      });
      return reply.code(200).send(responseBody);
    },
  );

  /** Non-lifecycle fields only — ownership and due date. State moves go through /transitions. */
  app.patch('/issues/:issueId', { preHandler: requireSession(deps) }, async (request, reply) => {
    const currentUser = request.currentUser!;
    if (!requireRole(currentUser.role, 'analyst')) {
      return reply
        .code(403)
        .type('application/problem+json')
        .send(problem(403, 'auth.forbidden', 'Analyst role required'));
    }
    const { issueId } = request.params as { issueId: string };
    const existing = await db
      .selectFrom('issues')
      .select(['id', 'state', 'updated_at', 'owner_user_id', 'due_date'])
      .where('id', '=', issueId)
      .executeTakeFirst();
    if (!existing) {
      return reply
        .code(404)
        .type('application/problem+json')
        .send(problem(404, 'resource.not_found', 'Issue not found'));
    }
    if (!ifMatchSatisfied(request.headers['if-match'], issueConcurrencyToken(existing))) {
      return reply
        .code(409)
        .type('application/problem+json')
        .send(problem(409, 'resource.stale', 'This issue changed since you loaded it'));
    }

    const body = request.body as { ownerUserId?: string | null; dueDate?: string | null };
    const updates: Record<string, unknown> = { updated_at: new Date() };
    if ('ownerUserId' in body) {
      if (body.ownerUserId) {
        const owner = await db
          .selectFrom('users')
          .select('id')
          .where('id', '=', body.ownerUserId)
          .where('is_active', '=', true)
          .executeTakeFirst();
        if (!owner) {
          return reply
            .code(400)
            .type('application/problem+json')
            .send(
              problem(
                400,
                'validation.schema_violation',
                'ownerUserId does not reference an active user',
              ),
            );
        }
      }
      updates.owner_user_id = body.ownerUserId ?? null;
    }
    if ('dueDate' in body) {
      updates.due_date = body.dueDate ? new Date(body.dueDate) : null;
    }

    await db.updateTable('issues').set(updates).where('id', '=', issueId).execute();
    await appendAuditEntry(db, {
      actorUserId: currentUser.userId,
      sessionId: currentUser.sessionId,
      sourceAddress: sourceAddressOf(request),
      action: 'issue.updated',
      targetType: 'issue',
      targetId: issueId,
      beforeState: { ownerUserId: existing.owner_user_id, dueDate: existing.due_date },
      afterState: { ownerUserId: updates.owner_user_id, dueDate: updates.due_date },
      outcome: 'success',
    });

    const updated = (await issueSelect(db)
      .where('issues.id', '=', issueId)
      .executeTakeFirstOrThrow()) as IssueRow;
    reply.header('ETag', issueConcurrencyToken(updated));
    return reply.code(200).send(toIssue(updated));
  });

  /** MOD-18: every weight change preserves the issue's historical score snapshot, and this is where the operator sees them. */
  app.get(
    '/issues/:issueId/risk-score-history',
    { preHandler: requireSession(deps) },
    async (request, reply) => {
      const { issueId } = request.params as { issueId: string };
      const rows = await db
        .selectFrom('issue_risk_score_snapshots')
        .selectAll()
        .where('issue_id', '=', issueId)
        .orderBy('computed_at', 'asc')
        .execute();
      return reply.code(200).send(
        rows.map((row) => ({
          id: row.id,
          issueId: row.issue_id,
          scoringPolicyVersion: row.scoring_policy_version,
          totalScore: Number(row.total_score),
          factorBreakdown: row.factor_breakdown,
          trigger: row.trigger,
          computedAt: row.computed_at,
        })),
      );
    },
  );

  app.get(
    '/issues/:issueId/verification-scans',
    { preHandler: requireSession(deps) },
    async (request, reply) => {
      const { issueId } = request.params as { issueId: string };
      const rows = await db
        .selectFrom('verification_scans')
        .selectAll()
        .where('issue_id', '=', issueId)
        .orderBy('requested_at', 'desc')
        .execute();
      return reply.code(200).send(
        rows.map((row) => ({
          id: row.id,
          issueId: row.issue_id,
          scanRunId: row.scan_run_id,
          requestedBy: row.requested_by,
          requestedAt: row.requested_at,
          outcome: row.outcome,
          resolvedAt: row.resolved_at,
        })),
      );
    },
  );

  app.get(
    '/verification-scans/:verificationScanId',
    { preHandler: requireSession(deps) },
    async (request, reply) => {
      const { verificationScanId } = request.params as { verificationScanId: string };
      const row = await db
        .selectFrom('verification_scans')
        .selectAll()
        .where('id', '=', verificationScanId)
        .executeTakeFirst();
      if (!row) {
        return reply
          .code(404)
          .type('application/problem+json')
          .send(problem(404, 'resource.not_found', 'Verification scan not found'));
      }
      return reply.code(200).send({
        id: row.id,
        issueId: row.issue_id,
        scanRunId: row.scan_run_id,
        requestedBy: row.requested_by,
        requestedAt: row.requested_at,
        outcome: row.outcome,
        resolvedAt: row.resolved_at,
      });
    },
  );
}
