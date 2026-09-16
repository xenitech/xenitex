/** ADR 0006: every creation POST requires a client-generated Idempotency-Key so a retried request can't create a duplicate resource. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
