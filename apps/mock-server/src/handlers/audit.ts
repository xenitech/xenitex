import type { AppState } from '../app-state.js';
import { paginate } from '../pagination.js';
import { queryOf, type MockHandler } from './generic.js';

export function buildAuditHandlers(state: AppState): Record<string, MockHandler> {
  return {
    listAuditEntries: (c, _req, reply) => {
      const query = queryOf(c);
      let items = state.auditEntries;
      const actorUserId = query.actorUserId;
      if (actorUserId) items = items.filter((e) => e.actorUserId === actorUserId);
      const targetType = query.targetType;
      if (targetType) items = items.filter((e) => e.targetType === targetType);
      const from = query.from;
      if (from) items = items.filter((e) => e.occurredAt >= from);
      const to = query.to;
      if (to) items = items.filter((e) => e.occurredAt <= to);
      const sorted = [...items].sort((a, b) => b.id - a.id);
      const limit = query.limit ? Number.parseInt(query.limit, 10) : undefined;
      const page = paginate(sorted, {
        cursor: query.cursor,
        limit,
        sortKey: (e) => e.id,
        id: (e) => String(e.id),
      });
      reply.code(200).send({ items: page.items, nextCursor: page.nextCursor });
    },
    exportAuditEntries: (_c, _req, reply) => {
      const header = 'id,actorUserId,action,targetType,targetId,outcome,occurredAt';
      const rows = state.auditEntries.map(
        (e) =>
          `${e.id},${e.actorUserId ?? ''},${e.action},${e.targetType},${e.targetId},${e.outcome},${e.occurredAt}`,
      );
      reply
        .code(200)
        .header('content-type', 'text/csv')
        .send([header, ...rows].join('\n'));
    },
    verifyAuditChain: (_c, _req, reply) => {
      reply.code(200).send({
        verifiedUpToId: state.auditEntries[state.auditEntries.length - 1]?.id ?? 0,
        gapsDetected: [],
        hashMismatches: [],
        isIntact: true,
      });
    },
  };
}
