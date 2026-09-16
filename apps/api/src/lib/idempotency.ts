import type { Redis } from 'ioredis';

/**
 * ADR 0006: every resource-creating POST requires an Idempotency-Key
 * header; a retried request with the same key against the same endpoint
 * returns the original response instead of creating a second resource.
 * Redis-backed, short TTL (24h — long enough to cover a client retrying
 * after a timeout, short enough not to accumulate forever).
 */
const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

interface StoredResponse {
  readonly status: number;
  readonly body: unknown;
}

export async function getIdempotentResponse(
  redis: Redis,
  routeKey: string,
  idempotencyKey: string,
): Promise<StoredResponse | null> {
  const raw = await redis.get(`xenitex:idempotency:${routeKey}:${idempotencyKey}`);
  return raw ? (JSON.parse(raw) as StoredResponse) : null;
}

export async function storeIdempotentResponse(
  redis: Redis,
  routeKey: string,
  idempotencyKey: string,
  response: StoredResponse,
): Promise<void> {
  await redis.set(
    `xenitex:idempotency:${routeKey}:${idempotencyKey}`,
    JSON.stringify(response),
    'EX',
    IDEMPOTENCY_TTL_SECONDS,
  );
}
