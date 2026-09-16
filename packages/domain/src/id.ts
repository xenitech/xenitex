import { webcrypto } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';

// `uuid`'s v7 implementation reads the WebCrypto `crypto` global directly,
// which Node 20 (the engines-declared floor) exposes by default but Node 18
// does not without an experimental flag. This is a defensive no-op on any
// environment where it's already present — not a version-detection branch,
// just filling in what the runtime should already provide.
if (typeof globalThis.crypto === 'undefined') {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

/**
 * docs/database-schema.md §1: primary keys are UUIDv7 (time-sortable),
 * generated in the application layer — never `gen_random_uuid()` in SQL.
 * The one exception is `audit_entries`, which uses a BIGSERIAL for strict
 * DB-guaranteed ordering (DATA-02's hash chain needs a total order Postgres
 * itself guarantees, not one the application asserts).
 */
export function newId(): string {
  return uuidv7();
}
