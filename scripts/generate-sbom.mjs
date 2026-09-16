#!/usr/bin/env node
/**
 * LEG-04. Emits a CycloneDX SBOM for the whole workspace using cdxgen, which
 * understands pnpm workspaces directly (unlike @cyclonedx/cyclonedx-npm, which
 * only reads npm lockfiles). Output feeds both the release artifact and
 * scripts/assert-no-remote-exec-deps.mjs (PRIN-03).
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const outDir = 'sbom';
mkdirSync(outDir, { recursive: true });

const result = spawnSync(
  'npx',
  ['-y', '@cyclonedx/cdxgen@10', '-o', `${outDir}/sbom.json`, '--type', 'nodejs', '.'],
  { stdio: 'inherit' },
);

if (result.status !== 0) {
  console.error('generate-sbom: cdxgen failed');
  process.exit(result.status ?? 1);
}

console.log(`SBOM written to ${outDir}/sbom.json`);
