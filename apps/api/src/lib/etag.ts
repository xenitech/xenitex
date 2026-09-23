import { createHash } from 'node:crypto';

/**
 * ADR 0006: mutable resources round-trip an `ETag`/`If-Match` pair so a
 * client cannot overwrite a change it never saw.
 *
 * One implementation, imported everywhere. This function previously existed
 * as seven byte-identical private copies across the route modules, each
 * with a comment explaining that duplicating it was fine — which held right
 * up until `issues.ts` turned out not to have a copy at all, and therefore
 * never emitted an ETag on `GET /issues/{id}`. The panel reads that header
 * before enabling any lifecycle action, so every triage button in the issue
 * detail panel silently did nothing. A convention that has to be
 * re-implemented per file is a convention that will eventually be missed in
 * one; this makes it impossible to have half of it.
 */
export function etagFor(value: unknown): string {
  return `"${createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32)}"`;
}

/**
 * Compares a client-supplied `If-Match` header against the current
 * representation's ETag. `*` matches any existing resource, per RFC 9110.
 */
export function ifMatchSatisfied(ifMatchHeader: unknown, currentEtag: string): boolean {
  const header = Array.isArray(ifMatchHeader) ? ifMatchHeader[0] : ifMatchHeader;
  if (typeof header !== 'string' || header.length === 0) return false;
  if (header.trim() === '*') return true;
  return (
    header
      .split(',')
      .map((candidate) => candidate.trim())
      // A proxy may weaken a strong validator; `W/"x"` and `"x"` denote the
      // same representation for a comparison this coarse.
      .some((candidate) => candidate.replace(/^W\//, '') === currentEtag)
  );
}
