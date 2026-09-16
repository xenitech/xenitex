#!/usr/bin/env node
// P1-26: bundle budget checked in CI. The appliance is air-gapped at runtime
// (no CDN, no external fonts, no analytics) — self-hosted fonts and every
// dependency ship in this one bundle, so the budget exists to catch a
// dependency creeping the shipped JS size, not to be a tight ceiling.
import { gzipSync } from 'node:zlib';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath/dirname rather than import.meta.dirname (Node 20.11+ only) —
// this script also runs under the Node 18 the reference dev environment has.
const here = dirname(fileURLToPath(import.meta.url));
const DIST_ASSETS_DIR = join(here, '..', 'dist', 'assets');
const JS_GZIP_BUDGET_BYTES = 260_000;
const CSS_GZIP_BUDGET_BYTES = 30_000;

async function gzipSizeOf(filePath) {
  const content = await readFile(filePath);
  return gzipSync(content).length;
}

async function main() {
  const files = await readdir(DIST_ASSETS_DIR);
  const jsFiles = files.filter((f) => f.endsWith('.js'));
  const cssFiles = files.filter((f) => f.endsWith('.css'));

  let jsTotal = 0;
  for (const file of jsFiles) jsTotal += await gzipSizeOf(join(DIST_ASSETS_DIR, file));
  let cssTotal = 0;
  for (const file of cssFiles) cssTotal += await gzipSizeOf(join(DIST_ASSETS_DIR, file));

  console.log(
    `JS (gzip):  ${(jsTotal / 1000).toFixed(1)} KB / ${(JS_GZIP_BUDGET_BYTES / 1000).toFixed(0)} KB budget`,
  );
  console.log(
    `CSS (gzip): ${(cssTotal / 1000).toFixed(1)} KB / ${(CSS_GZIP_BUDGET_BYTES / 1000).toFixed(0)} KB budget`,
  );

  const overBudget = [];
  if (jsTotal > JS_GZIP_BUDGET_BYTES) overBudget.push('JS');
  if (cssTotal > CSS_GZIP_BUDGET_BYTES) overBudget.push('CSS');

  if (overBudget.length > 0) {
    console.error(`\nBundle budget exceeded for: ${overBudget.join(', ')}.`);
    console.error(
      'If this growth is intentional, raise the budget in this script with a comment explaining why.',
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
