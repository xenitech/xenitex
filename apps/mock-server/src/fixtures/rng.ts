/**
 * QA-03: the seed generator must be deterministic so a PERF-01-volume fixture
 * is reproducible across runs and machines — no crypto-strength requirement
 * here, just a small, dependency-free, seedable PRNG (mulberry32).
 */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Rng {
  readonly float: () => number;
  readonly int: (min: number, max: number) => number;
  readonly pick: <T>(items: readonly T[]) => T;
  readonly weightedPick: <T>(items: readonly (readonly [T, number])[]) => T;
  readonly boolean: (probabilityTrue: number) => boolean;
  readonly uuid: () => string;
}

export function makeRng(seed: number): Rng {
  const next = createRng(seed);
  const float = () => next();
  const int = (min: number, max: number) => min + Math.floor(float() * (max - min + 1));
  const pick = <T>(items: readonly T[]): T => items[int(0, items.length - 1)]!;
  const weightedPick = <T>(items: readonly (readonly [T, number])[]): T => {
    const total = items.reduce((sum, [, w]) => sum + w, 0);
    let roll = float() * total;
    for (const [item, weight] of items) {
      roll -= weight;
      if (roll <= 0) return item;
    }
    return items[items.length - 1]![0];
  };
  const boolean = (probabilityTrue: number) => float() < probabilityTrue;
  const uuid = () => {
    // Not a real UUIDv7 (packages/domain generates those for real records) — this
    // only needs to be a stable-looking, collision-free-at-fixture-scale identifier.
    const hex = () => int(0, 15).toString(16);
    const block = (n: number) => Array.from({ length: n }, hex).join('');
    return `${block(8)}-${block(4)}-7${block(3)}-${block(4)}-${block(12)}`;
  };
  return { float, int, pick, weightedPick, boolean, uuid };
}
