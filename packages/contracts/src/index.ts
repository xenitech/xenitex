/**
 * Step 2 deliverable (P1-01/P1-02): the OpenAPI 3.1 specification
 * (openapi.yaml) is the single source of truth. `src/generated/types.ts` is
 * generated from it by `pnpm generate` (openapi-typescript) — never
 * hand-edited; `scripts/verify-generated.mjs` fails CI on drift.
 */
export type { paths, components, operations } from './generated/types.js';
export { createXenitexClient, type XenitexClient } from './client.js';
