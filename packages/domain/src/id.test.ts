import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newId } from './id.js';

test('newId produces distinct, valid UUIDv7 strings', () => {
  const a = newId();
  const b = newId();
  assert.notEqual(a, b);
  // Version nibble is '7' (13th hex character, per RFC 9562).
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});

test('newId is time-sortable: later calls sort after earlier ones lexicographically', async () => {
  const first = newId();
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = newId();
  assert.ok(first < second);
});
