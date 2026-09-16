import assert from 'node:assert/strict';
import { test } from 'node:test';
import { main } from './main.js';

test('main does not throw', () => {
  assert.doesNotThrow(() => main());
});
