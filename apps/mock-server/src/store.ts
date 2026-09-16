import { createHash } from 'node:crypto';

/**
 * Generic in-memory backing store for one resource collection. ADR 0006
 * requires ETag/If-Match on every mutable resource — computed here from a
 * canonical JSON serialisation, so it changes iff the resource's observable
 * content changes, matching how a real DB-backed implementation would derive
 * one from a row hash or updated_at.
 */
export class Collection<T extends { id: string }> {
  private readonly items = new Map<string, T>();

  constructor(initial: readonly T[] = []) {
    for (const item of initial) this.items.set(item.id, item);
  }

  all(): T[] {
    return [...this.items.values()];
  }

  get(id: string): T | undefined {
    return this.items.get(id);
  }

  set(item: T): T {
    this.items.set(item.id, item);
    return item;
  }

  patch(id: string, patch: Partial<T>): T | undefined {
    const existing = this.items.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...patch };
    this.items.set(id, updated);
    return updated;
  }

  delete(id: string): boolean {
    return this.items.delete(id);
  }

  get size(): number {
    return this.items.size;
  }
}

export function computeETag(resource: unknown): string {
  const canonical = JSON.stringify(resource, Object.keys(resource as object).sort());
  return `"${createHash('sha256').update(canonical).digest('hex').slice(0, 32)}"`;
}
