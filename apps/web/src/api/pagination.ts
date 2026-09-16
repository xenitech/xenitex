/** Flattens react-query's `useInfiniteQuery` pages — every list screen's virtualized view works over one flat array. */
export function flattenPages<T>(
  pages: readonly { items: readonly T[] }[] | undefined,
): readonly T[] {
  return pages?.flatMap((page) => page.items) ?? [];
}
