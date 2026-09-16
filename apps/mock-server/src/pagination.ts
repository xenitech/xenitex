/**
 * ADR 0006: opaque cursor pagination, never offset. The cursor encodes
 * (sortValue, id) of the last row of the previous page, base64-encoded and
 * opaque to the client — correct under concurrent inserts/updates, unlike a
 * raw offset integer.
 */
interface CursorPayload {
  readonly sortValue: string | number;
  readonly id: string;
}

export function encodeCursor(sortValue: string | number, id: string): string {
  return Buffer.from(JSON.stringify({ sortValue, id } satisfies CursorPayload), 'utf8').toString(
    'base64url',
  );
}

export function decodeCursor(cursor: string): CursorPayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'id' in parsed &&
      'sortValue' in parsed &&
      typeof parsed.id === 'string'
    ) {
      return parsed as CursorPayload;
    }
    return null;
  } catch {
    return null;
  }
}

export interface PaginateOptions<T> {
  readonly cursor?: string | null | undefined;
  readonly limit?: number | undefined;
  /** Descending by default (newest/highest first) — matches every list screen in Step 3 (risk score, firstSeen, etc). */
  readonly sortKey: (item: T) => string | number;
  readonly id: (item: T) => string;
  readonly descending?: boolean;
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

/**
 * `items` must already be sorted by `sortKey` (desc unless `descending: false`)
 * with ties broken by `id` — the fixture generators and collection stores
 * maintain that invariant so this function stays a pure slice, not a re-sort
 * on every page (irrelevant at fixture scale, but it's the shape production
 * pagination over an indexed column actually has).
 */
export function paginate<T>(items: readonly T[], options: PaginateOptions<T>): Page<T> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 500);
  const descending = options.descending ?? true;

  let startIndex = 0;
  if (options.cursor) {
    const decoded = decodeCursor(options.cursor);
    if (decoded) {
      startIndex = items.findIndex((item) => {
        const key = options.sortKey(item);
        const id = options.id(item);
        if (key === decoded.sortValue)
          return id === decoded.id ? false : isAfter(id, decoded.id, descending);
        return isAfter(key, decoded.sortValue, descending);
      });
      if (startIndex === -1) startIndex = items.length;
      // findIndex above returns the first item strictly after the cursor position;
      // walk forward past any exact (sortValue, id) match to be safe against ties.
      const exactMatchIndex = items.findIndex(
        (item) => options.sortKey(item) === decoded.sortValue && options.id(item) === decoded.id,
      );
      if (exactMatchIndex !== -1) startIndex = exactMatchIndex + 1;
    }
  }

  const page = items.slice(startIndex, startIndex + limit);
  const hasMore = startIndex + limit < items.length;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(options.sortKey(last), options.id(last)) : null;

  return { items: page, nextCursor };
}

function isAfter(a: string | number, b: string | number, descending: boolean): boolean {
  if (a === b) return false;
  const after = a < b;
  return descending ? after : !after;
}
