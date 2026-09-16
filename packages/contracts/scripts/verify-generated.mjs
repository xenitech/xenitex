#!/usr/bin/env node
/**
 * P1-02: the TypeScript types are generated from openapi.yaml, never
 * hand-written. This regenerates into a scratch file and diffs it against
 * the committed src/generated/types.ts — a mismatch means either the spec
 * changed without regenerating, or someone hand-edited the generated file.
 * Either is a CI failure, not a warning.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const committedPath = join(packageRoot, 'src/generated/types.ts');
const scratchDir = mkdtempSync(join(tmpdir(), 'xenitex-contracts-verify-'));
const scratchPath = join(scratchDir, 'types.ts');

try {
  execFileSync(
    join(packageRoot, 'node_modules/.bin/openapi-typescript'),
    [join(packageRoot, 'src/openapi.yaml'), '-o', scratchPath],
    { stdio: 'inherit' },
  );

  const committed = readFileSync(committedPath, 'utf8');
  const fresh = readFileSync(scratchPath, 'utf8');

  if (committed !== fresh) {
    console.error(
      'src/generated/types.ts is out of date with openapi.yaml.\n' +
        'Run `pnpm --filter @xenitex/contracts generate` and commit the result.',
    );
    process.exit(1);
  }

  console.log('src/generated/types.ts matches openapi.yaml.');
} finally {
  rmSync(scratchDir, { recursive: true, force: true });
}
