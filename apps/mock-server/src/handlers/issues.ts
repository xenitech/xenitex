import type { components } from '@xenitex/contracts';
import type { AppState } from '../app-state.js';
import { Problems } from '../problem.js';
import { computeETag } from '../store.js';
import { paginate } from '../pagination.js';
import { REMEDIATION_STEPS_BY_TYPE } from '../fixtures/data-pools.js';
import {
  checkIfMatch,
  makeDelete,
  makeGet,
  nextId,
  paramOf,
  queryOf,
  sendProblem,
  withIdempotency,
  type MockHandler,
} from './generic.js';

type Issue = components['schemas']['Issue'];
type IssueTransitionRequest = components['schemas']['IssueTransitionRequest'];

const VALID_MANUAL_TRANSITIONS: readonly IssueTransitionRequest['toState'][] = [
  'triaged',
  'in_progress',
  'mitigated',
  'reopened',
  'false_positive',
  'risk_accepted',
];

function applyTransition(
  state: AppState,
  issue: Issue,
  body: IssueTransitionRequest,
  actorUserId: string,
): Issue | { problem: ReturnType<typeof Problems.unprocessable> } {
  if (!VALID_MANUAL_TRANSITIONS.includes(body.toState)) {
    return {
      problem: Problems.unprocessable(
        'issue.system_only_transition',
        'verified_resolved is set only by a verification scan result (MOD-13).',
      ),
    };
  }
  if (body.toState === 'false_positive' && (!body.reasonCode || !body.justification)) {
    return {
      problem: Problems.unprocessable(
        'issue.false_positive_requires_reason',
        'false_positive requires a controlled-vocabulary reasonCode and justification (MOD-11).',
      ),
    };
  }
  const fromState = issue.state;
  const updated = state.issues.patch(issue.id, { state: body.toState })!;
  const history = state.issueStateHistoryByIssueId.get(issue.id) ?? [];
  history.push({
    id: nextId('history'),
    issueId: issue.id,
    fromState,
    toState: body.toState,
    actorUserId,
    reasonCode: body.reasonCode ?? null,
    justification: body.justification ?? null,
    verificationScanId: null,
    transitionedAt: new Date().toISOString(),
  });
  state.issueStateHistoryByIssueId.set(issue.id, history);
  return updated;
}

export function buildIssueHandlers(state: AppState): Record<string, MockHandler> {
  return {
    listIssues: (c, _req, reply) => {
      const query = queryOf(c);
      let items = state.issues.all();
      const stateFilter = c.request.query?.state;
      if (stateFilter) {
        const states = Array.isArray(stateFilter) ? stateFilter : [stateFilter];
        items = items.filter((i) => states.includes(i.state));
      }
      const confidenceFloor = query.confidenceFloor
        ? Number.parseFloat(query.confidenceFloor)
        : 0.4;
      items = items.filter((i) => i.confidence >= confidenceFloor);
      const minRiskScore = query.minRiskScore;
      if (minRiskScore) items = items.filter((i) => i.riskScore >= Number.parseFloat(minRiskScore));
      const assetIdFilter = query.assetId;
      if (assetIdFilter) items = items.filter((i) => i.assetId === assetIdFilter);
      const ownerUserIdFilter = query.ownerUserId;
      if (ownerUserIdFilter) items = items.filter((i) => i.ownerUserId === ownerUserIdFilter);
      if (query.overdue === 'true') {
        const now = new Date().toISOString();
        items = items.filter(
          (i) =>
            i.dueDate != null &&
            i.dueDate < now &&
            i.state !== 'verified_resolved' &&
            i.state !== 'false_positive',
        );
      }

      const sortField = query.sort ?? 'riskScore';
      const sortKey =
        sortField === 'dueDate'
          ? (i: Issue) => i.dueDate ?? ''
          : sortField === 'firstSeen'
            ? (i: Issue) => i.firstSeen
            : sortField === 'lastSeen'
              ? (i: Issue) => i.lastSeen
              : (i: Issue) => i.riskScore;

      const sorted = [...items].sort((a, b) =>
        sortKey(a) < sortKey(b) ? 1 : sortKey(a) > sortKey(b) ? -1 : 0,
      );
      const limit = query.limit ? Number.parseInt(query.limit, 10) : undefined;
      const page = paginate(sorted, { cursor: query.cursor, limit, sortKey, id: (i) => i.id });
      reply.code(200).send({ items: page.items, nextCursor: page.nextCursor });
    },

    getIssue: (c, _req, reply) => {
      const id = paramOf(c, 'issueId');
      const issue = state.issues.get(id);
      if (!issue) return sendProblem(reply, Problems.notFound('issue'));
      const asset = state.assets.get(issue.assetId)!;
      const vulnerability = issue.vulnerabilityId
        ? (state.vulnerabilities.get(issue.vulnerabilityId) ?? null)
        : null;
      const observations = issue.contributingObservationIds
        .map((oid) => state.observations.get(oid))
        .filter((o): o is NonNullable<typeof o> => Boolean(o));
      const breakdown = state.issueBreakdownById.get(id) ?? [];
      const configKey = vulnerability ? null : issue.productUntrusted;
      const remediationSteps = configKey
        ? (REMEDIATION_STEPS_BY_TYPE[configKey] ?? REMEDIATION_STEPS_BY_TYPE.default)
        : (vulnerability?.canonicalRemediation ?? REMEDIATION_STEPS_BY_TYPE.default);
      reply
        .header('etag', computeETag(issue))
        .code(200)
        .send({
          ...issue,
          asset,
          vulnerability,
          observations,
          riskScoreBreakdown: breakdown,
          remediationGuidance: {
            priorityRationale: vulnerability?.knownExploited
              ? 'Known-exploited vulnerability — prioritise ahead of items with a higher CVSS but no known exploitation (MOD-16).'
              : 'Prioritised per the current risk-scoring policy weights (MOD-17).',
            remediationSteps,
            references: vulnerability
              ? [`https://nvd.nist.gov/vuln/detail/${vulnerability.cveIds[0]}`]
              : [],
          },
        });
    },

    updateIssue: (c, req, reply) => {
      const id = paramOf(c, 'issueId');
      const existing = state.issues.get(id);
      if (!existing) return sendProblem(reply, Problems.notFound('issue'));
      if (!checkIfMatch(reply, req, existing)) return;
      const patch = c.request.requestBody as Partial<Pick<Issue, 'ownerUserId' | 'dueDate'>>;
      const updated = state.issues.patch(id, patch)!;
      reply.header('etag', computeETag(updated)).code(200).send(updated);
    },

    transitionIssue: (c, req, reply) => {
      const id = paramOf(c, 'issueId');
      const issue = state.issues.get(id);
      if (!issue) return sendProblem(reply, Problems.notFound('issue'));
      if (!checkIfMatch(reply, req, issue)) return;
      const body = c.request.requestBody as IssueTransitionRequest;
      const result = applyTransition(state, issue, body, 'user-analyst-1');
      if ('problem' in result) return sendProblem(reply, result.problem);
      reply.header('etag', computeETag(result)).code(200).send(result);
    },

    listIssueHistory: (c, _req, reply) => {
      const id = paramOf(c, 'issueId');
      if (!state.issues.get(id)) return sendProblem(reply, Problems.notFound('issue'));
      const items = (state.issueStateHistoryByIssueId.get(id) ?? [])
        .slice()
        .sort((a, b) => (a.transitionedAt < b.transitionedAt ? 1 : -1));
      const query = queryOf(c);
      const limit = query.limit ? Number.parseInt(query.limit, 10) : undefined;
      const page = paginate(items, {
        cursor: query.cursor,
        limit,
        sortKey: (h) => h.transitionedAt,
        id: (h) => h.id,
      });
      reply.code(200).send({ items: page.items, nextCursor: page.nextCursor });
    },

    listIssueRiskScoreHistory: (c, _req, reply) => {
      const id = paramOf(c, 'issueId');
      if (!state.issues.get(id)) return sendProblem(reply, Problems.notFound('issue'));
      reply.code(200).send(state.riskScoreSnapshotsByIssueId.get(id) ?? []);
    },

    listIssueVerificationScans: (c, _req, reply) => {
      const id = paramOf(c, 'issueId');
      if (!state.issues.get(id)) return sendProblem(reply, Problems.notFound('issue'));
      reply.code(200).send(state.verificationScansByIssueId.get(id) ?? []);
    },

    bulkTransitionIssues: (c, _req, reply) => {
      const body = c.request.requestBody as {
        issueIds: string[];
        transition: IssueTransitionRequest;
      };
      const results = body.issueIds.map((issueId) => {
        const issue = state.issues.get(issueId);
        if (!issue)
          return { issueId, outcome: 'failed' as const, problem: Problems.notFound('issue') };
        const result = applyTransition(state, issue, body.transition, 'user-analyst-1');
        if ('problem' in result)
          return { issueId, outcome: 'failed' as const, problem: result.problem };
        return { issueId, outcome: 'applied' as const };
      });
      reply.code(200).send({ results });
    },

    listSavedViews: (_c, _req, reply) => reply.code(200).send(state.savedViews.all()),
    createSavedView: (c, req, reply) => {
      withIdempotency('createSavedView', req, reply, () => {
        const body = c.request.requestBody as Omit<
          components['schemas']['SavedView'],
          'id' | 'createdBy'
        >;
        const view: components['schemas']['SavedView'] = {
          id: nextId('view'),
          createdBy: 'user-analyst-1',
          ...body,
        };
        state.savedViews.set(view);
        return { status: 201, body: view };
      });
    },
    getSavedView: makeGet(state.savedViews, 'viewId', 'saved_view', false),
    updateSavedView: (c, req, reply) => {
      const id = paramOf(c, 'viewId');
      const existing = state.savedViews.get(id);
      if (!existing) return sendProblem(reply, Problems.notFound('saved_view'));
      if (!checkIfMatch(reply, req, existing)) return;
      const updated = state.savedViews.patch(id, c.request.requestBody as object)!;
      reply.code(200).send(updated);
    },
    deleteSavedView: makeDelete(state.savedViews, 'viewId', 'saved_view'),

    listExceptions: (c, _req, reply) => {
      const query = queryOf(c);
      let items = state.exceptions.all();
      if (query.status) items = items.filter((e) => e.status === query.status);
      const limit = query.limit ? Number.parseInt(query.limit, 10) : undefined;
      const page = paginate(items, {
        cursor: query.cursor,
        limit,
        sortKey: (e) => e.requestedAt ?? '',
        id: (e) => e.id,
      });
      reply.code(200).send({ items: page.items, nextCursor: page.nextCursor });
    },
    createException: (c, req, reply) => {
      const body = c.request.requestBody as {
        issueId: string;
        justification: string;
        expiresAt: string;
      };
      const issue = state.issues.get(body.issueId);
      if (!issue)
        return sendProblem(
          reply,
          Problems.validationFailed('issueId does not reference an existing issue.'),
        );
      const requestedAt = Date.now();
      const maxExpiry = requestedAt + 365 * 86_400_000;
      if (new Date(body.expiresAt).getTime() > maxExpiry) {
        return sendProblem(
          reply,
          Problems.unprocessable(
            'exception.expiry_exceeds_maximum',
            'expiresAt exceeds the 365-day GATE 1-accepted maximum (MOD-12).',
          ),
        );
      }
      withIdempotency('createException', req, reply, () => {
        const exception: components['schemas']['Exception'] = {
          id: nextId('exception'),
          issueId: body.issueId,
          requestedBy: 'user-analyst-1',
          requestedAt: new Date().toISOString(),
          justification: body.justification,
          approverUserId: null,
          approvedAt: null,
          expiresAt: body.expiresAt,
          status: 'pending',
        };
        state.exceptions.set(exception);
        return { status: 201, body: exception };
      });
    },
    getException: makeGet(state.exceptions, 'exceptionId', 'exception', false),
    approveException: (c, _req, reply) => {
      const id = paramOf(c, 'exceptionId');
      const existing = state.exceptions.get(id);
      if (!existing) return sendProblem(reply, Problems.notFound('exception'));
      const approverUserId = 'user-operator-1';
      if (approverUserId === existing.requestedBy) {
        return sendProblem(
          reply,
          Problems.unprocessable(
            'exception.approver_is_requester',
            'The approver must differ from the requester (MOD-12).',
          ),
        );
      }
      const updated = state.exceptions.patch(id, {
        status: 'approved',
        approverUserId,
        approvedAt: new Date().toISOString(),
      })!;
      state.issues.patch(updated.issueId, { state: 'risk_accepted', exceptionId: updated.id });
      reply.code(200).send(updated);
    },
    rejectException: (c, _req, reply) => {
      const id = paramOf(c, 'exceptionId');
      if (!state.exceptions.get(id)) return sendProblem(reply, Problems.notFound('exception'));
      reply.code(200).send(state.exceptions.patch(id, { status: 'rejected' }));
    },
    revokeException: (c, _req, reply) => {
      const id = paramOf(c, 'exceptionId');
      const existing = state.exceptions.get(id);
      if (!existing) return sendProblem(reply, Problems.notFound('exception'));
      const updated = state.exceptions.patch(id, { status: 'revoked' })!;
      state.issues.patch(updated.issueId, { state: 'reopened', exceptionId: null });
      reply.code(200).send(updated);
    },

    listRiskScoringPolicies: (_c, _req, reply) => reply.code(200).send(state.riskScoringPolicies),
    createRiskScoringPolicy: (c, req, reply) => {
      const body = c.request.requestBody as components['schemas']['RiskScoringWeights'];
      withIdempotency('createRiskScoringPolicy', req, reply, () => {
        for (const old of state.riskScoringPolicies) old.isActive = false;
        const nextVersion = state.riskScoringPolicies.length + 1;
        const policy: components['schemas']['RiskScoringPolicy'] = {
          version: nextVersion,
          weights: body,
          isActive: true,
          createdBy: 'user-administrator-1',
          createdAt: new Date().toISOString(),
        };
        state.riskScoringPolicies.push(policy);
        return {
          status: 201,
          body: policy,
          headers: { location: `/v1/risk-scoring-policies/${nextVersion}/recompute-status` },
        };
      });
    },
    getActiveRiskScoringPolicy: (_c, _req, reply) => {
      reply
        .code(200)
        .send(state.riskScoringPolicies.find((p) => p.isActive) ?? state.riskScoringPolicies[0]);
    },
    getRiskScoringRecomputeStatus: (_c, _req, reply) => {
      reply.code(200).send({
        status: 'completed',
        issuesTotal: state.issues.size,
        issuesRecomputed: state.issues.size,
      });
    },

    listSlaPolicies: (_c, _req, reply) => reply.code(200).send(state.slaPolicies),
    createSlaPolicyMatrix: (c, req, reply) => {
      const body = c.request.requestBody as components['schemas']['SlaPolicyRow'][];
      withIdempotency('createSlaPolicyMatrix', req, reply, () => {
        const nextVersion = (state.slaPolicies[0]?.version ?? 0) + 1;
        const rows = body.map((row) => ({
          id: nextId(`sla-v${nextVersion}`),
          version: nextVersion,
          isActive: true,
          ...row,
        }));
        state.slaPolicies.length = 0;
        state.slaPolicies.push(...rows);
        return { status: 201, body: rows };
      });
    },
  };
}
