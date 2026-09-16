import type { components } from '@xenitex/contracts';
import type { AppState } from '../app-state.js';
import { Problems } from '../problem.js';
import { paginate } from '../pagination.js';
import {
  makeGet,
  nextId,
  paramOf,
  queryOf,
  sendProblem,
  withIdempotency,
  type MockHandler,
} from './generic.js';

const planPreviews = new Map<string, components['schemas']['ScanPlanPreview']>();

export function buildScanHandlers(state: AppState): Record<string, MockHandler> {
  return {
    createScanPlan: (c, req, reply) => {
      const body = c.request.requestBody as { scopeId: string; profileId: string };
      const scope = state.authorizedScopes.get(body.scopeId);
      const profile = state.scanProfiles.get(body.profileId);
      if (!scope || !profile)
        return sendProblem(
          reply,
          Problems.validationFailed('scopeId/profileId must reference existing resources.'),
        );

      withIdempotency('createScanPlan', req, reply, () => {
        const targetCount = Math.floor(Math.random() * 200) + 20;
        const preview: components['schemas']['ScanPlanPreview'] = {
          id: nextId('planpreview'),
          scopeId: body.scopeId,
          profileId: body.profileId,
          targetCount,
          estimatedPacketVolume: targetCount * profile.pacing.concurrentPortsPerHost * 4,
          estimatedDurationSeconds:
            Math.ceil(targetCount / Math.max(1, profile.pacing.concurrentHosts)) * 30,
          excludedTargets: [],
          fragileDowngrades: [],
          confirmedByUserId: null,
          confirmedAt: null,
        };
        planPreviews.set(preview.id, preview);
        return { status: 201, body: preview };
      });
    },

    listScanRuns: (c, _req, reply) => {
      const query = queryOf(c);
      const items = [...state.scanRuns.all()].sort((a, b) => (a.queuedAt < b.queuedAt ? 1 : -1));
      const limit = query.limit ? Number.parseInt(query.limit, 10) : undefined;
      const page = paginate(items, {
        cursor: query.cursor,
        limit,
        sortKey: (r) => r.queuedAt,
        id: (r) => r.id,
      });
      reply.code(200).send({ items: page.items, nextCursor: page.nextCursor });
    },

    createScanRun: (c, req, reply) => {
      const body = c.request.requestBody as {
        planPreviewId: string;
        confirm: true;
        standardProfileConfirmationText?: string;
      };
      const preview = planPreviews.get(body.planPreviewId);
      if (!preview) return sendProblem(reply, Problems.notFound('scan_plan_preview'));
      if (preview.confirmedAt)
        return sendProblem(
          reply,
          Problems.conflict(
            'scan_plan.already_confirmed',
            'This plan preview was already confirmed.',
          ),
        );
      const profile = state.scanProfiles.get(preview.profileId)!;
      if (profile.requiresConfirmation && !body.standardProfileConfirmationText) {
        return sendProblem(
          reply,
          Problems.unprocessable(
            'scan_plan.confirmation_required',
            'standard intrusiveness requires typed confirmation (SAFE-03).',
          ),
        );
      }

      withIdempotency('createScanRun', req, reply, () => {
        preview.confirmedByUserId = 'user-operator-1';
        preview.confirmedAt = new Date().toISOString();
        const id = nextId('scanrun');
        const run: components['schemas']['ScanRun'] = {
          id,
          planPreviewId: preview.id,
          scopeId: preview.scopeId,
          profileId: preview.profileId,
          initiatedByUserId: 'user-operator-1',
          status: 'queued',
          correlationId: `corr-${id}`,
          queuedAt: new Date().toISOString(),
          startedAt: null,
          completedAt: null,
          abortedByUserId: null,
          targetsTotal: preview.targetCount,
          targetsCompleted: 0,
        };
        state.scanRuns.set(run);
        return { status: 202, body: run, headers: { location: `/v1/scan-runs/${id}` } };
      });
    },

    getScanRun: makeGet(state.scanRuns, 'scanRunId', 'scan_run', false),

    listScanRunTargets: (c, _req, reply) => {
      const runId = paramOf(c, 'scanRunId');
      if (!state.scanRuns.get(runId)) return sendProblem(reply, Problems.notFound('scan_run'));
      const items = state.scanRunTargetsByRunId.get(runId) ?? [];
      const query = queryOf(c);
      const limit = query.limit ? Number.parseInt(query.limit, 10) : undefined;
      const page = paginate(items, {
        cursor: query.cursor,
        limit,
        sortKey: (t) => t.id,
        id: (t) => t.id,
      });
      reply.code(200).send({ items: page.items, nextCursor: page.nextCursor });
    },

    listScanRunRawArtifacts: (c, _req, reply) => {
      const runId = paramOf(c, 'scanRunId');
      if (!state.scanRuns.get(runId)) return sendProblem(reply, Problems.notFound('scan_run'));
      reply.code(200).send(state.rawArtifactsByRunId.get(runId) ?? []);
    },

    pauseScanRun: (c, _req, reply) => transitionScanRun(state, c, reply, 'paused'),
    resumeScanRun: (c, _req, reply) => transitionScanRun(state, c, reply, 'running'),
    abortScanRun: (c, _req, reply) => {
      const id = paramOf(c, 'scanRunId');
      const run = state.scanRuns.get(id);
      if (!run) return sendProblem(reply, Problems.notFound('scan_run'));
      const body = c.request.requestBody as { reason?: string } | undefined;
      const updated = state.scanRuns.patch(id, {
        status: 'aborted',
        completedAt: new Date().toISOString(),
        abortedByUserId: 'user-operator-1',
      })!;
      void body;
      reply.code(200).send(updated);
    },

    createVerificationScan: (c, req, reply) => {
      const body = c.request.requestBody as { issueId: string };
      const issue = state.issues.get(body.issueId);
      if (!issue) return sendProblem(reply, Problems.notFound('issue'));
      withIdempotency('createVerificationScan', req, reply, () => {
        const id = nextId('verification');
        const scan: components['schemas']['VerificationScan'] = {
          id,
          issueId: body.issueId,
          scanRunId: state.scanRuns.all()[0]!.id,
          requestedBy: 'user-analyst-1',
          requestedAt: new Date().toISOString(),
          outcome: 'pending',
          resolvedAt: null,
        };
        state.verificationScans.set(scan);
        const list = state.verificationScansByIssueId.get(body.issueId) ?? [];
        list.push(scan);
        state.verificationScansByIssueId.set(body.issueId, list);
        return { status: 202, body: scan, headers: { location: `/v1/verification-scans/${id}` } };
      });
    },
    getVerificationScan: makeGet(
      state.verificationScans,
      'verificationScanId',
      'verification_scan',
      false,
    ),

    invokeGlobalStop: (c, _req, reply) => {
      const body = c.request.requestBody as { reason?: string } | undefined;
      const running = state.scanRuns
        .all()
        .filter((r) => r.status === 'queued' || r.status === 'running' || r.status === 'paused');
      for (const run of running)
        state.scanRuns.patch(run.id, { status: 'aborted', completedAt: new Date().toISOString() });
      const event: components['schemas']['GlobalStopEvent'] = {
        id: nextId('global-stop'),
        invokedByUserId: 'user-operator-1',
        invokedVia: 'web',
        invokedAt: new Date().toISOString(),
        reason: body?.reason ?? null,
        scanRunsHalted: running.map((r) => r.id),
      };
      state.globalStopEvents.push(event);
      reply.code(200).send(event);
    },
    listGlobalStopHistory: (c, _req, reply) => {
      const query = queryOf(c);
      const items = [...state.globalStopEvents].sort((a, b) =>
        a.invokedAt < b.invokedAt ? 1 : -1,
      );
      const limit = query.limit ? Number.parseInt(query.limit, 10) : undefined;
      const page = paginate(items, {
        cursor: query.cursor,
        limit,
        sortKey: (e) => e.invokedAt,
        id: (e) => e.id,
      });
      reply.code(200).send({ items: page.items, nextCursor: page.nextCursor });
    },
  };
}

function transitionScanRun(
  state: AppState,
  c: import('openapi-backend').Context,
  reply: import('fastify').FastifyReply,
  status: 'paused' | 'running',
) {
  const id = paramOf(c, 'scanRunId');
  const run = state.scanRuns.get(id);
  if (!run) return sendProblem(reply, Problems.notFound('scan_run'));
  const updated = state.scanRuns.patch(id, {
    status,
    startedAt: run.startedAt ?? new Date().toISOString(),
  })!;
  reply.code(200).send(updated);
}
