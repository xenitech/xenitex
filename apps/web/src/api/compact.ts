/**
 * Strips `undefined`-valued keys. Needed because the generated client types
 * (openapi-typescript) declare optional query/body properties as absent-or-
 * present, not present-with-undefined — and the workspace's
 * `exactOptionalPropertyTypes: true` enforces that distinction at compile
 * time. Every optional query-param object passed to `apiClient` goes
 * through this rather than each call site hand-rolling the same filter.
 */
type Compacted<T> = { [K in keyof T]?: Exclude<T[K], undefined> };

export function compact<T extends Record<string, unknown>>(obj: T): Compacted<T> {
  const result: Compacted<T> = {};
  for (const key in obj) {
    const value = obj[key];
    if (value !== undefined) result[key] = value as Exclude<T[typeof key], undefined>;
  }
  return result;
}
