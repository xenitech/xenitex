import type { components } from '@xenitex/contracts';
import type { AppState } from '../app-state.js';
import { Problems } from '../problem.js';
import { computeETag } from '../store.js';
import { paginate } from '../pagination.js';
import {
  checkIfMatch,
  makeDelete,
  makeGet,
  makeListFlat,
  nextId,
  paramOf,
  queryOf,
  sendProblem,
  withIdempotency,
  type MockHandler,
} from './generic.js';

export function buildSafetyConfigHandlers(state: AppState): Record<string, MockHandler> {
  return {
    listAuthorizedScopes: (c, _req, reply) => {
      const query = queryOf(c);
      const items = state.authorizedScopes.all();
      const limit = query.limit ? Number.parseInt(query.limit, 10) : undefined;
      const page = paginate(items, {
        cursor: query.cursor,
        limit,
        sortKey: (s) => s.acceptedAt,
        id: (s) => s.id,
      });
      reply.code(200).send({ items: page.items, nextCursor: page.nextCursor });
    },
    createAuthorizedScope: (c, req, reply) => {
      const body = c.request.requestBody as components['schemas']['AuthorizedScopeCreate'];
      withIdempotency('createAuthorizedScope', req, reply, () => {
        const scope: components['schemas']['AuthorizedScope'] = {
          id: nextId('scope'),
          acceptedByUserId: 'user-administrator-1',
          acceptedAt: new Date().toISOString(),
          supersededById: null,
          ...body,
        };
        state.authorizedScopes.set(scope);
        return { status: 201, body: scope };
      });
    },
    getAuthorizedScope: makeGet(state.authorizedScopes, 'scopeId', 'authorized_scope', false),

    listExclusionRules: (c, _req, reply) => {
      const query = queryOf(c);
      let items = state.exclusionRules.all();
      if (query.scopeId) items = items.filter((r) => r.scopeId === query.scopeId);
      const limit = query.limit ? Number.parseInt(query.limit, 10) : undefined;
      const page = paginate(items, {
        cursor: query.cursor,
        limit,
        sortKey: (r) => r.id,
        id: (r) => r.id,
      });
      reply.code(200).send({ items: page.items, nextCursor: page.nextCursor });
    },
    createExclusionRule: (c, req, reply) => {
      const body = c.request.requestBody as components['schemas']['ExclusionRuleCreate'];
      withIdempotency('createExclusionRule', req, reply, () => {
        const rule: components['schemas']['ExclusionRule'] = {
          id: nextId('excl'),
          createdBy: 'user-administrator-1',
          isActive: true,
          ...body,
        };
        state.exclusionRules.set(rule);
        return { status: 201, body: rule };
      });
    },
    updateExclusionRule: (c, req, reply) => {
      const id = paramOf(c, 'ruleId');
      const existing = state.exclusionRules.get(id);
      if (!existing) return sendProblem(reply, Problems.notFound('exclusion_rule'));
      if (!checkIfMatch(reply, req, existing)) return;
      const updated = state.exclusionRules.patch(id, c.request.requestBody as object)!;
      reply.header('etag', computeETag(updated)).code(200).send(updated);
    },

    listScanProfiles: makeListFlat(() => state.scanProfiles.all()),
    createScanProfile: (c, req, reply) => {
      const body = c.request.requestBody as components['schemas']['ScanProfileCreate'];
      if (exceedsCeilings(body.pacing, state.pacingCeilings)) {
        return sendProblem(
          reply,
          Problems.unprocessable(
            'scan_profile.pacing_above_ceiling',
            'Requested pacing exceeds the system-wide pacing ceilings (SAFE-04).',
          ),
        );
      }
      withIdempotency('createScanProfile', req, reply, () => {
        const profile: components['schemas']['ScanProfile'] = {
          id: nextId('profile'),
          requiresConfirmation: body.intrusiveness === 'standard',
          ...body,
        };
        state.scanProfiles.set(profile);
        return { status: 201, body: profile };
      });
    },
    getScanProfile: makeGet(state.scanProfiles, 'profileId', 'scan_profile', false),
    updateScanProfile: (c, req, reply) => {
      const id = paramOf(c, 'profileId');
      const existing = state.scanProfiles.get(id);
      if (!existing) return sendProblem(reply, Problems.notFound('scan_profile'));
      if (!checkIfMatch(reply, req, existing)) return;
      const body = c.request.requestBody as components['schemas']['ScanProfileCreate'];
      if (exceedsCeilings(body.pacing, state.pacingCeilings)) {
        return sendProblem(
          reply,
          Problems.unprocessable(
            'scan_profile.pacing_above_ceiling',
            'Requested pacing exceeds the system-wide pacing ceilings (SAFE-04).',
          ),
        );
      }
      const updated = state.scanProfiles.patch(id, {
        ...body,
        requiresConfirmation: body.intrusiveness === 'standard',
      })!;
      reply.header('etag', computeETag(updated)).code(200).send(updated);
    },

    getPacingCeilings: (_c, _req, reply) => reply.code(200).send(state.pacingCeilings),
    updatePacingCeilings: (c, req, reply) => {
      if (!checkIfMatch(reply, req, state.pacingCeilings)) return;
      state.pacingCeilings = { ...state.pacingCeilings, ...(c.request.requestBody as object) };
      reply.header('etag', computeETag(state.pacingCeilings)).code(200).send(state.pacingCeilings);
    },

    listFragileDeviceRules: makeListFlat(() => state.fragileDeviceRules.all()),
    updateFragileDeviceRule: (c, req, reply) => {
      const id = paramOf(c, 'ruleId');
      const existing = state.fragileDeviceRules.get(id);
      if (!existing) return sendProblem(reply, Problems.notFound('fragile_device_rule'));
      if (!checkIfMatch(reply, req, existing)) return;
      const body = c.request.requestBody as { isEnabled: boolean };
      const updated = state.fragileDeviceRules.patch(id, { isEnabled: body.isEnabled })!;
      reply.header('etag', computeETag(updated)).code(200).send(updated);
    },

    listBlackoutWindows: (c, _req, reply) => {
      const query = queryOf(c);
      let items = state.blackoutWindows.all();
      if (query.scopeId) items = items.filter((w) => w.scopeId === query.scopeId);
      reply.code(200).send(items);
    },
    createBlackoutWindow: (c, req, reply) => {
      const body = c.request.requestBody as components['schemas']['BlackoutWindowCreate'];
      withIdempotency('createBlackoutWindow', req, reply, () => {
        const window: components['schemas']['BlackoutWindow'] = { id: nextId('blackout'), ...body };
        state.blackoutWindows.set(window);
        return { status: 201, body: window };
      });
    },
    updateBlackoutWindow: (c, req, reply) => {
      const id = paramOf(c, 'windowId');
      const existing = state.blackoutWindows.get(id);
      if (!existing) return sendProblem(reply, Problems.notFound('blackout_window'));
      if (!checkIfMatch(reply, req, existing)) return;
      const updated = state.blackoutWindows.patch(id, c.request.requestBody as object)!;
      reply.header('etag', computeETag(updated)).code(200).send(updated);
    },
    deleteBlackoutWindow: makeDelete(state.blackoutWindows, 'windowId', 'blackout_window'),

    listScanSchedules: (c, _req, reply) => {
      const query = queryOf(c);
      const items = state.scanSchedules.all();
      const limit = query.limit ? Number.parseInt(query.limit, 10) : undefined;
      const page = paginate(items, {
        cursor: query.cursor,
        limit,
        sortKey: (s) => s.id,
        id: (s) => s.id,
      });
      reply.code(200).send({ items: page.items, nextCursor: page.nextCursor });
    },
    createScanSchedule: (c, req, reply) => {
      const body = c.request.requestBody as components['schemas']['ScanScheduleCreate'];
      withIdempotency('createScanSchedule', req, reply, () => {
        const schedule: components['schemas']['ScanSchedule'] = {
          id: nextId('schedule'),
          ...body,
          isEnabled: body.isEnabled ?? true,
        };
        state.scanSchedules.set(schedule);
        return { status: 201, body: schedule };
      });
    },
    getScanSchedule: makeGet(state.scanSchedules, 'scheduleId', 'scan_schedule', false),
    updateScanSchedule: (c, req, reply) => {
      const id = paramOf(c, 'scheduleId');
      const existing = state.scanSchedules.get(id);
      if (!existing) return sendProblem(reply, Problems.notFound('scan_schedule'));
      if (!checkIfMatch(reply, req, existing)) return;
      const updated = state.scanSchedules.patch(id, c.request.requestBody as object)!;
      reply.header('etag', computeETag(updated)).code(200).send(updated);
    },
    deleteScanSchedule: makeDelete(state.scanSchedules, 'scheduleId', 'scan_schedule'),
  };
}

function exceedsCeilings(
  pacing: components['schemas']['PacingConfig'],
  ceilings: components['schemas']['PacingCeilings'],
): boolean {
  return (
    pacing.packetsPerSecond > ceilings.maxPacketsPerSecond ||
    pacing.concurrentHosts > ceilings.maxConcurrentHosts ||
    pacing.concurrentPortsPerHost > ceilings.maxConcurrentPortsPerHost ||
    pacing.timeoutMs > ceilings.maxTimeoutMs ||
    pacing.retries > ceilings.maxRetries
  );
}
