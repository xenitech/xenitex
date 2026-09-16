import type { components } from '@xenitex/contracts';
import type { AppState } from '../app-state.js';
import { Problems } from '../problem.js';
import { computeETag } from '../store.js';
import { paginate } from '../pagination.js';
import {
  checkIfMatch,
  makeDelete,
  makeGet,
  makeListPaginated,
  nextId,
  paramOf,
  queryOf,
  sendProblem,
  withIdempotency,
  type MockHandler,
} from './generic.js';

type Asset = components['schemas']['Asset'];

export function buildAssetHandlers(state: AppState): Record<string, MockHandler> {
  return {
    listAssets: (c, _req, reply) => {
      const query = queryOf(c);
      let items = state.assets.all();
      const lifecycleState = query.lifecycleState;
      if (lifecycleState) items = items.filter((a) => a.lifecycleState === lifecycleState);
      const criticality = query.criticality;
      if (criticality) items = items.filter((a) => a.businessCriticality === criticality);
      const exposure = query.exposure;
      if (exposure) items = items.filter((a) => a.exposureClassification === exposure);
      const tag = query.tag;
      if (tag) items = items.filter((a) => a.tags.includes(tag));
      const isFragile = query.isFragile;
      if (isFragile) items = items.filter((a) => String(a.isFragile) === isFragile);
      if (query.q) {
        const needle = query.q.toLowerCase();
        items = items.filter(
          (a) =>
            a.addresses.some((addr) => addr.address.includes(needle)) ||
            a.hostnames.some((h) => h.hostnameUntrusted.toLowerCase().includes(needle)) ||
            a.tags.some((t) => t.toLowerCase().includes(needle)),
        );
      }
      items = [...items].sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1));
      const limit = query.limit ? Number.parseInt(query.limit, 10) : undefined;
      const page = paginateLocal(
        items,
        query.cursor,
        limit,
        (a) => a.lastSeen,
        (a) => a.id,
      );
      reply.code(200).send(page);
    },

    getAsset: makeGet(state.assets, 'assetId', 'asset'),

    updateAsset: (c, req, reply) => {
      const id = paramOf(c, 'assetId');
      const existing = state.assets.get(id);
      if (!existing) return sendProblem(reply, Problems.notFound('asset'));
      if (!checkIfMatch(reply, req, existing)) return;
      const patch = c.request.requestBody as Partial<Asset>;
      const updated = state.assets.patch(id, patch)!;
      reply.header('etag', computeETag(updated)).code(200).send(updated);
    },

    listAssetIssues: (c, _req, reply) => {
      const assetId = paramOf(c, 'assetId');
      if (!state.assets.get(assetId)) return sendProblem(reply, Problems.notFound('asset'));
      const items = (state.issuesByAssetId.get(assetId) ?? [])
        .slice()
        .sort((a, b) => b.riskScore - a.riskScore);
      const query = queryOf(c);
      const limit = query.limit ? Number.parseInt(query.limit, 10) : undefined;
      reply.code(200).send(
        paginateLocal(
          items,
          query.cursor,
          limit,
          (i) => i.riskScore,
          (i) => i.id,
        ),
      );
    },

    listAssetScanHistory: (c, _req, reply) => {
      const assetId = paramOf(c, 'assetId');
      if (!state.assets.get(assetId)) return sendProblem(reply, Problems.notFound('asset'));
      const runIds = state.scanRunIdsByAssetId.get(assetId) ?? new Set<string>();
      const items = state.scanRuns
        .all()
        .filter((r) => runIds.has(r.id))
        .sort((a, b) => (a.queuedAt < b.queuedAt ? 1 : -1));
      const query = queryOf(c);
      const limit = query.limit ? Number.parseInt(query.limit, 10) : undefined;
      reply.code(200).send(
        paginateLocal(
          items,
          query.cursor,
          limit,
          (r) => r.queuedAt,
          (r) => r.id,
        ),
      );
    },

    listAssetMergeCandidates: makeListPaginated(() => [], { sortKey: () => 0, id: () => '' }),

    createAssetMerge: (c, req, reply) => {
      const body = c.request.requestBody as { survivorAssetId: string; mergedAssetId: string };
      if (!state.assets.get(body.survivorAssetId) || !state.assets.get(body.mergedAssetId)) {
        return sendProblem(
          reply,
          Problems.validationFailed(
            'Both survivorAssetId and mergedAssetId must reference existing assets.',
          ),
        );
      }
      withIdempotency('createAssetMerge', req, reply, () => {
        state.assets.patch(body.mergedAssetId, {
          lifecycleState: 'merged',
          mergedIntoAssetId: body.survivorAssetId,
        });
        const event: components['schemas']['AssetMergeEvent'] = {
          id: nextId('merge-event'),
          survivorAssetId: body.survivorAssetId,
          mergedAssetId: body.mergedAssetId,
          policyVersion: 1,
          confidence: 0.9,
          performedAt: new Date().toISOString(),
        };
        return { status: 201, body: event };
      });
    },

    reverseAssetMerge: (c, req, reply) => {
      const body = c.request.requestBody as { reason: string };
      reply.code(200).send({
        id: paramOf(c, 'eventId'),
        survivorAssetId: 'unknown',
        mergedAssetId: 'unknown',
        policyVersion: 1,
        confidence: 0.9,
        performedAt: new Date().toISOString(),
        reversedBy: 'user-admin-1',
        reversedAt: new Date().toISOString(),
        reversalReason: body.reason,
      });
    },

    listAssetGroups: (c, _req, reply) => {
      const query = queryOf(c);
      const items = state.assetGroups.all();
      const limit = query.limit ? Number.parseInt(query.limit, 10) : undefined;
      reply.code(200).send(
        paginateLocal(
          items,
          query.cursor,
          limit,
          (g) => g.id,
          (g) => g.id,
        ),
      );
    },
    createAssetGroup: (c, req, reply) => {
      const body = c.request.requestBody as Omit<components['schemas']['AssetGroup'], 'id'>;
      withIdempotency('createAssetGroup', req, reply, () => {
        const group: components['schemas']['AssetGroup'] = { id: nextId('group'), ...body };
        state.assetGroups.set(group);
        return { status: 201, body: group };
      });
    },
    getAssetGroup: makeGet(state.assetGroups, 'groupId', 'asset_group'),
    updateAssetGroup: (c, req, reply) => {
      const id = paramOf(c, 'groupId');
      const existing = state.assetGroups.get(id);
      if (!existing) return sendProblem(reply, Problems.notFound('asset_group'));
      if (!checkIfMatch(reply, req, existing)) return;
      const updated = state.assetGroups.patch(id, c.request.requestBody as object)!;
      reply.header('etag', computeETag(updated)).code(200).send(updated);
    },
    deleteAssetGroup: makeDelete(state.assetGroups, 'groupId', 'asset_group'),
    addAssetGroupMember: (_c, _req, reply) => reply.code(204).send(),
    removeAssetGroupMember: (_c, _req, reply) => reply.code(204).send(),
  };
}

function paginateLocal<T>(
  items: readonly T[],
  cursor: string | undefined,
  limit: number | undefined,
  sortKey: (item: T) => string | number,
  id: (item: T) => string,
): { items: T[]; nextCursor: string | null } {
  const page = paginate(items, { cursor, limit, sortKey, id });
  return { items: [...page.items], nextCursor: page.nextCursor };
}
