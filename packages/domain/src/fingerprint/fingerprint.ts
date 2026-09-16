import { createHash } from 'node:crypto';
import { CURRENT_FINGERPRINT_VERSION, type FingerprintInput } from '../entities/issue.js';

/**
 * MOD-08. The one and only place a fingerprint is computed. Changing the tuple
 * or the hash algorithm requires bumping CURRENT_FINGERPRINT_VERSION and writing
 * a forward migration (docs/adr/0002-issue-fingerprint.md) — never re-fingerprint
 * existing issues in place, or first_seen/SLA history is destroyed silently.
 *
 * v1 tuple (accepted at GATE 1):
 *   sha256(identityAnchor || "\0" || vulnerabilityIdentifier || "\0" || port || "\0" || protocol)
 */
export function computeFingerprint(
  input: FingerprintInput,
  version: number = CURRENT_FINGERPRINT_VERSION,
): string {
  if (version !== 1) {
    throw new Error(`computeFingerprint: no implementation for fingerprint version ${version}`);
  }
  const tuple = [
    input.identityAnchor,
    input.vulnerabilityIdentifier ?? '',
    input.port === null ? '' : String(input.port),
    input.protocol ?? '',
  ].join('\0');
  return createHash('sha256').update(tuple).digest('hex');
}
