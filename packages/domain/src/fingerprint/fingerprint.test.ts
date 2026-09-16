import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FingerprintInput } from '../entities/issue.js';
import { computeFingerprint } from './fingerprint.js';

const baseInput: FingerprintInput = {
  identityAnchor: 'machine_uuid:1234-5678',
  vulnerabilityIdentifier: 'CVE-2024-0001',
  port: 443,
  protocol: 'tcp',
};

test('computeFingerprint is deterministic for identical input (MOD-08)', () => {
  assert.equal(computeFingerprint(baseInput), computeFingerprint(baseInput));
});

test('computeFingerprint changes when any tuple field changes', () => {
  const original = computeFingerprint(baseInput);
  assert.notEqual(computeFingerprint({ ...baseInput, port: 8443 }), original);
  assert.notEqual(computeFingerprint({ ...baseInput, protocol: 'udp' }), original);
  assert.notEqual(
    computeFingerprint({ ...baseInput, vulnerabilityIdentifier: 'CVE-2024-0002' }),
    original,
  );
  assert.notEqual(
    computeFingerprint({ ...baseInput, identityAnchor: 'machine_uuid:9999' }),
    original,
  );
});

test('computeFingerprint handles a null vulnerability and port (configuration/exposure issues, MOD-04)', () => {
  const configIssueInput: FingerprintInput = {
    identityAnchor: 'machine_uuid:1234-5678',
    vulnerabilityIdentifier: null,
    port: null,
    protocol: null,
  };
  assert.doesNotThrow(() => computeFingerprint(configIssueInput));
});

test('computeFingerprint rejects an unsupported fingerprint version rather than guessing (MOD-08)', () => {
  assert.throws(
    () => computeFingerprint(baseInput, 2),
    /no implementation for fingerprint version 2/,
  );
});
