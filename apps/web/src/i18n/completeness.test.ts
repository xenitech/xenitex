import { describe, expect, it } from 'vitest';
import { en } from './locales/en.js';
import { fa } from './locales/fa.js';

/**
 * P1-20: every string externalised, English and Persian, from the first
 * commit. `en.ts`'s own header comment has always claimed this file existed
 * and enforced key parity — it did not, and the only i18n test in the
 * repository spot-checked two hard-coded keys. A Persian-speaking operator
 * would simply have seen raw dotted key paths wherever a key had been added
 * to `en.ts` alone, with nothing in CI to catch it.
 */

type Leaf = string | readonly string[];

function flatten(value: unknown, prefix = ''): Map<string, Leaf> {
  const out = new Map<string, Leaf>();
  if (typeof value !== 'object' || value === null) return out;
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === 'string' || Array.isArray(child)) {
      out.set(path, child as Leaf);
    } else {
      for (const [k, v] of flatten(child, path)) out.set(k, v);
    }
  }
  return out;
}

const enKeys = flatten(en);
const faKeys = flatten(fa);

/** `{{name}}` placeholders must match, or an interpolated value silently vanishes in one language. */
function placeholdersIn(value: Leaf): string[] {
  const text = Array.isArray(value) ? value.join('|') : (value as string);
  return [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!).sort();
}

describe('i18n completeness (P1-20)', () => {
  it('has a Persian string for every English key', () => {
    const missing = [...enKeys.keys()].filter((key) => !faKeys.has(key));
    expect(missing, `missing from fa.ts: ${missing.join(', ')}`).toEqual([]);
  });

  it('has no Persian key without an English counterpart', () => {
    // The other direction matters too: a stray fa-only key is dead weight
    // that looks like coverage.
    const orphaned = [...faKeys.keys()].filter((key) => !enKeys.has(key));
    expect(orphaned, `present in fa.ts but not en.ts: ${orphaned.join(', ')}`).toEqual([]);
  });

  it('uses the same interpolation placeholders in both languages', () => {
    const mismatched: string[] = [];
    for (const [key, enValue] of enKeys) {
      const faValue = faKeys.get(key);
      if (faValue === undefined) continue;
      const enPlaceholders = placeholdersIn(enValue);
      const faPlaceholders = placeholdersIn(faValue);
      if (enPlaceholders.join(',') !== faPlaceholders.join(',')) {
        mismatched.push(
          `${key} (en: ${enPlaceholders.join('/')}, fa: ${faPlaceholders.join('/')})`,
        );
      }
    }
    expect(mismatched, `placeholder mismatch: ${mismatched.join('; ')}`).toEqual([]);
  });

  it('keeps list-valued strings the same length in both languages', () => {
    // e.g. setup.safety.items — a Persian bundle one item short would drop
    // a safety statement from the acknowledgement screen without erroring.
    const mismatched: string[] = [];
    for (const [key, enValue] of enKeys) {
      const faValue = faKeys.get(key);
      if (!Array.isArray(enValue) || !Array.isArray(faValue)) continue;
      if (enValue.length !== faValue.length) {
        mismatched.push(`${key} (en: ${enValue.length}, fa: ${faValue.length})`);
      }
    }
    expect(mismatched, `list length mismatch: ${mismatched.join('; ')}`).toEqual([]);
  });

  it('never leaves a value empty', () => {
    const empty = [...enKeys, ...faKeys]
      .filter(([, value]) =>
        Array.isArray(value) ? value.length === 0 : (value as string).trim() === '',
      )
      .map(([key]) => key);
    expect(empty, `empty strings: ${empty.join(', ')}`).toEqual([]);
  });
});
