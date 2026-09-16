import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Context } from 'openapi-backend';
import { Collection, computeETag } from '../store.js';
import { paginate } from '../pagination.js';
import { Problems, type ProblemDetails } from '../problem.js';

export type MockHandler = (c: Context, req: FastifyRequest, reply: FastifyReply) => unknown;

export function sendProblem(reply: FastifyReply, p: ProblemDetails): void {
  reply.code(p.status).header('content-type', 'application/problem+json').send(p);
}

export function queryOf(c: Context): Record<string, string> {
  return (c.request.query ?? {}) as Record<string, string>;
}

export function paramOf(c: Context, name: string): string {
  return String((c.request.params as Record<string, string>)[name]);
}

export function makeListFlat<T>(getItems: () => readonly T[]): MockHandler {
  return (_c, _req, reply) => reply.code(200).send([...getItems()]);
}

export interface PaginatedListOptions<T> {
  readonly sortKey: (item: T) => string | number;
  readonly id: (item: T) => string;
  readonly descending?: boolean;
}

export function makeListPaginated<T>(
  getItems: () => readonly T[],
  opts: PaginatedListOptions<T>,
): MockHandler {
  return (c, _req, reply) => {
    const query = queryOf(c);
    const limit = query.limit ? Number.parseInt(query.limit, 10) : undefined;
    const page = paginate(getItems(), { cursor: query.cursor, limit, ...opts });
    reply.code(200).send({ items: page.items, nextCursor: page.nextCursor });
  };
}

export function makeGet<T extends { id: string }>(
  collection: Collection<T>,
  paramName: string,
  resourceName: string,
  withETag = true,
): MockHandler {
  return (c, _req, reply) => {
    const id = paramOf(c, paramName);
    const item = collection.get(id);
    if (!item) return sendProblem(reply, Problems.notFound(resourceName));
    if (withETag) reply.header('etag', computeETag(item));
    reply.code(200).send(item);
  };
}

export function makeDelete<T extends { id: string }>(
  collection: Collection<T>,
  paramName: string,
  resourceName: string,
): MockHandler {
  return (c, _req, reply) => {
    const id = paramOf(c, paramName);
    if (!collection.get(id)) return sendProblem(reply, Problems.notFound(resourceName));
    collection.delete(id);
    reply.code(204).send();
  };
}

export function checkIfMatch<T>(reply: FastifyReply, req: FastifyRequest, current: T): boolean {
  const ifMatch = req.headers['if-match'];
  if (!ifMatch) {
    sendProblem(reply, Problems.ifMatchRequired());
    return false;
  }
  const currentTag = computeETag(current);
  if (ifMatch !== currentTag) {
    sendProblem(reply, Problems.staleResource());
    return false;
  }
  return true;
}

/** ADR 0006: Idempotency-Key replay — a retried creation request returns the original response, never a second resource. */
const idempotencyCache = new Map<string, { status: number; body: unknown }>();

export function withIdempotency(
  operationId: string,
  req: FastifyRequest,
  reply: FastifyReply,
  create: () => { status: number; body: unknown; headers?: Record<string, string> },
): void {
  const key = req.headers['idempotency-key'];
  const cacheKey = key ? `${operationId}:${key}` : null;
  if (cacheKey) {
    const cached = idempotencyCache.get(cacheKey);
    if (cached) {
      reply.code(cached.status).send(cached.body);
      return;
    }
  }
  const result = create();
  if (result.headers) for (const [k, v] of Object.entries(result.headers)) reply.header(k, v);
  reply.code(result.status).send(result.body);
  if (cacheKey) idempotencyCache.set(cacheKey, { status: result.status, body: result.body });
}

let sequence = 0;
export function nextId(prefix: string): string {
  sequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${sequence}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
