import assert from 'node:assert/strict';
import { test } from 'node:test';
import { confidenceLabel, unitInterval } from './primitives.js';

test('unitInterval accepts the closed range [0, 1]', () => {
  assert.equal(unitInterval(0), 0);
  assert.equal(unitInterval(1), 1);
  assert.equal(unitInterval(0.5), 0.5);
});

test('unitInterval rejects anything outside [0, 1]', () => {
  assert.throws(() => unitInterval(-0.01), RangeError);
  assert.throws(() => unitInterval(1.01), RangeError);
  assert.throws(() => unitInterval(Number.NaN), RangeError);
});

test('confidenceLabel matches the MOD-19/MOD-20 thresholds mirrored in the issues.confidence_label generated column', () => {
  assert.equal(confidenceLabel(unitInterval(0.9)), 'high');
  assert.equal(confidenceLabel(unitInterval(0.75)), 'high');
  assert.equal(confidenceLabel(unitInterval(0.74)), 'medium');
  assert.equal(confidenceLabel(unitInterval(0.4)), 'medium');
  assert.equal(confidenceLabel(unitInterval(0.39)), 'low');
  assert.equal(confidenceLabel(unitInterval(0)), 'low');
});
