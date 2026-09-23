import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import { i18next } from '../../i18n/index.js';
import { RiskExplainer } from './RiskExplainer.js';

function renderExplainer(factors: unknown, version = 2) {
  return render(
    <I18nextProvider i18n={i18next}>
      <RiskExplainer factors={factors as never} scoringPolicyVersion={version} />
    </I18nextProvider>,
  );
}

/**
 * `issue_risk_score_snapshots.factor_breakdown` is a schema-less `jsonb`
 * column, so what arrives here is whatever the scoring function of the day
 * wrote — not necessarily what the current TypeScript type describes.
 * Persisted data outlives the code that produced it.
 */
describe('RiskExplainer (MOD-17)', () => {
  const current = [
    {
      factor: 'cvssBaseScore',
      multiplier: 1,
      runningScore: 98,
      inputDescription: '9.8 (CVSS v3.1)',
    },
    {
      factor: 'knownExploited',
      multiplier: 1.5,
      runningScore: 100,
      inputDescription: 'known-exploited',
    },
  ];

  it('renders the multiplier and running score for the current format', () => {
    renderExplainer(current);
    expect(screen.getByText(/9\.8 \(CVSS v3\.1\)/)).toBeTruthy();
    expect(screen.getByText(/×1\.50/)).toBeTruthy();
    expect(screen.getByText(/100\.0/)).toBeTruthy();
  });

  /**
   * Regression. The scoring function moved from a weighted SUM to a
   * multiplicative model in migration 0012, and the snapshots written
   * before that were never migrated — they carry `{weight, rawValue,
   * contribution}` and no `multiplier`/`runningScore`. Calling `.toFixed()`
   * on the missing field threw a TypeError that React Router surfaced as
   * its built-in developer error screen, with a raw stack trace, on a
   * customer's appliance.
   */
  it('does not throw on a pre-migration-0012 breakdown, and says why it cannot explain it', () => {
    const legacy = [
      { factor: 'cvssBaseScore', weight: 0.15, rawValue: 0, contribution: 0 },
      { factor: 'exposureClassification', weight: 0.15, rawValue: 30, contribution: 4.5 },
    ];
    expect(() => renderExplainer(legacy)).not.toThrow();
    expect(screen.getByText(/earlier version of the scoring function/i)).toBeTruthy();
  });

  it('handles a missing breakdown without throwing', () => {
    expect(() => renderExplainer([])).not.toThrow();
    expect(screen.getByText(/No scoring breakdown was stored/i)).toBeTruthy();
  });

  it('survives null, undefined and non-array inputs', () => {
    for (const bad of [null, undefined, {}, 'nope', 42]) {
      expect(() => renderExplainer(bad)).not.toThrow();
    }
  });

  it('survives rows with non-finite numbers rather than printing NaN', () => {
    const broken = [
      { factor: 'cvssBaseScore', multiplier: Number.NaN, runningScore: 10, inputDescription: 'x' },
      {
        factor: 'confidence',
        multiplier: 1,
        runningScore: Number.POSITIVE_INFINITY,
        inputDescription: 'y',
      },
    ];
    expect(() => renderExplainer(broken)).not.toThrow();
    expect(screen.queryByText(/NaN/)).toBeNull();
    expect(screen.queryByText(/Infinity/)).toBeNull();
  });

  /**
   * A partially readable breakdown must not be quietly trimmed: the rows
   * that do render will not add up to the issue's total score, and a
   * reader must be told rather than left to discover it by arithmetic.
   */
  it('reports a partially readable breakdown instead of silently dropping rows', () => {
    renderExplainer([...current, { factor: 'confidence', weight: 0.1, contribution: 2 }]);
    expect(screen.getByText(/Showing 2 of 3 stored factors/i)).toBeTruthy();
  });

  it('renders an unknown factor name rather than a missing-translation key', () => {
    renderExplainer([
      { factor: 'somethingNew', multiplier: 1.1, runningScore: 50, inputDescription: 'z' },
    ]);
    expect(screen.getByText('somethingNew')).toBeTruthy();
    expect(screen.queryByText(/components\.riskExplainer/)).toBeNull();
  });
});
