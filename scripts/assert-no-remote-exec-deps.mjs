#!/usr/bin/env node
/**
 * PRIN-03. No SSH client, no configuration-management engine, and no
 * remote-execution library appears anywhere in the dependency tree. This is
 * the automated CI check that verifies it against the SBOM (or, if no SBOM has
 * been generated yet, against the raw pnpm dependency graph) -- not a policy
 * doc anyone has to remember to re-read.
 *
 * The denylist is intentionally an EXACT package-name match, not a substring
 * or regex: substring matching on npm package names produces false positives
 * constantly (e.g. a package merely named "*-ssh-config-parser" that never
 * opens a connection), and a security gate that cries wolf gets disabled.
 * Extend this list deliberately, with a one-line reason, when a new forbidden
 * category of dependency is identified.
 */
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const FORBIDDEN_PACKAGES = new Map([
  // SSH clients (PRIN-02/PRIN-03: nothing in this product ever opens an SSH session).
  ['ssh2', 'SSH client library'],
  ['node-ssh', 'SSH client library'],
  ['simple-ssh', 'SSH client library'],
  ['ssh2-sftp-client', 'SSH/SFTP client library'],
  ['node-scp', 'SCP-over-SSH client library'],
  ['scp2', 'SCP-over-SSH client library'],
  ['ssh-exec', 'SSH remote command execution library'],
  // Configuration-management / remote-execution engines (PRIN-01: read-only; nothing configures a customer host).
  ['ansible', 'configuration-management engine'],
  ['fabric', 'remote-execution/deployment engine'],
  ['nodemiko', 'network device remote-execution library'],
  ['pssh', 'parallel-SSH execution tool'],
  ['@saltstack/salt', 'configuration-management engine'],
]);

function namesFromSbom(sbomPath) {
  const sbom = JSON.parse(readFileSync(sbomPath, 'utf8'));
  const names = new Set();
  for (const component of sbom.components ?? []) {
    if (typeof component.name === 'string') names.add(component.name.toLowerCase());
    if (typeof component.purl === 'string') {
      const match = component.purl.match(/^pkg:npm\/(?:(@[^/]+)\/)?([^@]+)/);
      if (match) names.add(`${match[1] ? match[1] + '/' : ''}${match[2]}`.toLowerCase());
    }
  }
  return names;
}

function namesFromPnpmGraph() {
  const raw = execFileSync('npx', ['-y', 'pnpm@9', 'list', '-r', '--depth', 'Infinity', '--json'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const workspaces = JSON.parse(raw);
  const names = new Set();
  const walk = (deps) => {
    if (!deps) return;
    for (const [name, info] of Object.entries(deps)) {
      names.add(name.toLowerCase());
      if (info && typeof info === 'object') {
        walk(info.dependencies);
      }
    }
  };
  for (const workspace of workspaces) {
    walk(workspace.dependencies);
    walk(workspace.devDependencies);
  }
  return names;
}

const sbomPath = 'sbom/sbom.json';
const names = existsSync(sbomPath) ? namesFromSbom(sbomPath) : namesFromPnpmGraph();

const violations = [...FORBIDDEN_PACKAGES.entries()].filter(([pkg]) =>
  names.has(pkg.toLowerCase()),
);

if (violations.length > 0) {
  console.error('PRIN-03 VIOLATION: forbidden dependency found in the dependency tree:');
  for (const [pkg, reason] of violations) {
    console.error(`  - ${pkg} (${reason})`);
  }
  process.exit(1);
}

console.log(
  `PRIN-03 check passed: no forbidden dependency among ${names.size} packages inspected.`,
);
