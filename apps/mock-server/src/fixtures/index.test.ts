import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateFixtures } from './index.js';

/** QA-03/2.4: the mock server must serve a fixture at exactly the PERF-01 volumes (Part A.5). */
test('PERF-01 fixture scale matches the documented volumes: 5,000 assets, 50,000 issues, 250,000 observations', () => {
  const fixtures = generateFixtures({
    host: '127.0.0.1',
    port: 0,
    fixtureScale: 'perf01',
    seed: 1,
    setupIncomplete: false,
  });
  assert.equal(fixtures.assets.length, 5000);
  assert.equal(fixtures.issues.length, 50_000);
  assert.equal(fixtures.observations.length, 250_000);
});

test('fixture generation is deterministic for a given seed (QA-03: reproducible)', () => {
  const a = generateFixtures({
    host: '127.0.0.1',
    port: 0,
    fixtureScale: 'small',
    seed: 7,
    setupIncomplete: false,
  });
  const b = generateFixtures({
    host: '127.0.0.1',
    port: 0,
    fixtureScale: 'small',
    seed: 7,
    setupIncomplete: false,
  });
  assert.deepEqual(
    a.assets.map((x) => x.id),
    b.assets.map((x) => x.id),
  );
  assert.equal(a.issues[0]!.riskScore, b.issues[0]!.riskScore);
  assert.equal(a.issues[0]!.fingerprint, b.issues[0]!.fingerprint);
});

test('every issue risk score is explainable: the last breakdown row equals the stored riskScore (MOD-17, docs/issues-scoring-dashboard-spec.md SCORE 2.2)', () => {
  const fixtures = generateFixtures({
    host: '127.0.0.1',
    port: 0,
    fixtureScale: 'small',
    seed: 3,
    setupIncomplete: false,
  });
  for (const issue of fixtures.issues.slice(0, 50)) {
    const breakdown = fixtures.issueBreakdownById.get(issue.id) ?? [];
    const last = breakdown[breakdown.length - 1];
    assert.ok(last, `issue ${issue.id}: no breakdown rows`);
    assert.ok(
      Math.abs(last!.runningScore - issue.riskScore) < 0.01,
      `issue ${issue.id}: last breakdown row ${last!.runningScore} !== riskScore ${issue.riskScore}`,
    );
  }
});

test('every issue with contributing observations references observations that actually exist (MOD-21)', () => {
  const fixtures = generateFixtures({
    host: '127.0.0.1',
    port: 0,
    fixtureScale: 'small',
    seed: 3,
    setupIncomplete: false,
  });
  const observationIds = new Set(fixtures.observations.map((o) => o.id));
  for (const issue of fixtures.issues) {
    for (const obsId of issue.contributingObservationIds) {
      assert.ok(
        observationIds.has(obsId),
        `issue ${issue.id} references missing observation ${obsId}`,
      );
    }
  }
});
