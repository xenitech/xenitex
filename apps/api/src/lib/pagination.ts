/**
 * ADR 0006: opaque cursor, never a raw offset. Every collection endpoint's
 * cursor is just the last row's `id` (UUIDv7, so already time-ordered),
 * base64url-encoded so it's opaque to the client and never guessable as a
 * position. `WHERE id > cursor ORDER BY id ASC LIMIT n+1` is what stays
 * correct under concurrent inserts that offset pagination silently
 * skips/duplicates rows under.
 */
export function encodeCursor(id: string): string {
  return Buffer.from(id, 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): string | null {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    return decoded.length > 0 ? decoded : null;
  } catch {
    return null;
  }
}

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 500;

export function parseLimit(rawLimit: unknown): number {
  const parsed = typeof rawLimit === 'string' ? Number.parseInt(rawLimit, 10) : NaN;
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_PAGE_LIMIT;
  return Math.min(parsed, MAX_PAGE_LIMIT);
}

/** Splits an `n+1`-row fetch (ordered by id ascending) into a page + nextCursor. */
export function buildPage<Row extends { id: string }, Out>(
  rows: readonly Row[],
  limit: number,
  toOut: (row: Row) => Out,
): { items: Out[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const lastRow = pageRows.at(-1);
  return {
    items: pageRows.map(toOut),
    nextCursor: hasMore && lastRow ? encodeCursor(lastRow.id) : null,
  };
}
