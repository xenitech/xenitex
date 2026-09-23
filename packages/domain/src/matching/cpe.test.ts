import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  candidateProductNames,
  compareVersions,
  evaluateVersionRange,
  matchServiceToCpe,
  matchServiceToVulnerability,
  normaliseProductName,
  parseCpe23,
  parseVersion,
} from './cpe.js';

describe('parseCpe23', () => {
  it('parses a standard CPE 2.3 formatted string', () => {
    const parsed = parseCpe23('cpe:2.3:a:apache:http_server:2.4.49:*:*:*:*:*:*:*');
    assert.deepEqual(parsed, {
      part: 'a',
      vendor: 'apache',
      product: 'http_server',
      version: '2.4.49',
    });
  });

  it('handles the ANY version wildcard', () => {
    assert.equal(parseCpe23('cpe:2.3:a:haxx:curl:*:*:*:*:*:*:*:*')!.version, '*');
  });

  it('respects backslash-escaped colons inside a component', () => {
    // A bare split(':') would shift every field after the escaped colon,
    // turning a real product into a mis-parsed one and silently losing the
    // vulnerability.
    const parsed = parseCpe23(String.raw`cpe:2.3:a:vendor:pro\:duct:1.0:*:*:*:*:*:*:*`);
    assert.equal(parsed!.product, 'pro:duct');
    assert.equal(parsed!.version, '1.0');
  });

  it('rejects anything that is not a CPE 2.3 string', () => {
    for (const bad of ['', 'cpe:/a:apache:http_server:2.4.49', 'nope', 'cpe:2.3:a']) {
      assert.equal(parseCpe23(bad), null, bad);
    }
  });
});

describe('parseVersion', () => {
  it('parses plain upstream versions', () => {
    assert.deepEqual(parseVersion('2.4.49').segments, [2, 4, 49]);
    assert.deepEqual(parseVersion('8').segments, [8]);
    assert.deepEqual(parseVersion('v1.2.3').segments, [1, 2, 3]);
  });

  it("keeps OpenSSL's trailing letter, which is a real release component", () => {
    const parsed = parseVersion('1.0.2k');
    assert.deepEqual(parsed.segments, [1, 0, 2]);
    assert.equal(parsed.letter, 'k');
  });

  it('separates a distribution revision from the upstream version', () => {
    for (const [raw, revision] of [
      ['2.4.49-1ubuntu1.3', '1ubuntu1.3'],
      ['1.2.3+deb11u2', 'deb11u2'],
      ['2.4.6-97.el7.centos', '97.el7.centos'],
    ] as const) {
      const parsed = parseVersion(raw);
      assert.deepEqual(parsed.segments, parseVersion(raw.split(/[-+]/)[0]!).segments, raw);
      assert.equal(parsed.vendorRevision, revision, raw);
      assert.equal(parsed.preRelease, null, raw);
    }
  });

  it('distinguishes a pre-release from a distribution revision', () => {
    assert.equal(parseVersion('1.2.3-rc1').preRelease, 'rc1');
    assert.equal(parseVersion('1.2.3-rc1').vendorRevision, null);
    assert.equal(parseVersion('1.2.3~beta').preRelease, 'beta');
  });

  it('strips an epoch, which orders distro releases and means nothing upstream', () => {
    assert.deepEqual(parseVersion('1:2.4.49').segments, [2, 4, 49]);
  });

  it("parses OpenSSL's multi-letter releases", () => {
    const parsed = parseVersion('1.0.2zq');
    assert.deepEqual(parsed.segments, [1, 0, 2]);
    assert.equal(parsed.letter, 'zq');
  });

  it('reports unparseable rather than guessing', () => {
    for (const bad of ['', 'unknown', 'Debian', '(Ubuntu)', null, undefined]) {
      assert.equal(parseVersion(bad as never).parsed, false, String(bad));
    }
  });
});

describe('compareVersions', () => {
  const cmp = (a: string, b: string) => compareVersions(parseVersion(a), parseVersion(b));

  it('orders by numeric segment, not lexically', () => {
    // The classic trap: '10' sorts before '9' as a string.
    assert.equal(cmp('2.4.10', '2.4.9'), 1);
    assert.equal(cmp('1.0.0', '1.0.1'), -1);
  });

  it('treats a missing segment as zero', () => {
    assert.equal(cmp('2.4', '2.4.0'), 0);
  });

  it('orders OpenSSL letter releases, including the za..zz continuation', () => {
    assert.equal(cmp('1.0.2k', '1.0.2j'), 1);
    assert.equal(cmp('1.0.2', '1.0.2a'), -1);
    // After 1.0.2z OpenSSL continues 1.0.2za, 1.0.2zb ... 1.0.2zz. These
    // are real releases (1.0.2zq, 1.1.1zh) and they must sort after the
    // single-letter ones, not before.
    assert.equal(cmp('1.0.2za', '1.0.2z'), 1);
    assert.equal(cmp('1.0.2zq', '1.0.2zh'), 1);
    assert.equal(cmp('1.0.2zh', '1.0.2zq'), -1);
    assert.equal(cmp('1.0.2b', '1.0.2za'), -1);
  });

  it('sorts a pre-release before its release', () => {
    assert.equal(cmp('1.2.3-rc1', '1.2.3'), -1);
  });

  it('ignores the distribution revision when comparing upstream', () => {
    assert.equal(cmp('2.4.49-1ubuntu1.3', '2.4.49'), 0);
  });

  it('returns null when either side is unparseable', () => {
    assert.equal(cmp('unknown', '1.0.0'), null);
  });
});

describe('evaluateVersionRange', () => {
  const evaluate = (version: string, range: string) =>
    evaluateVersionRange(parseVersion(version), range);

  it('evaluates a single upper bound', () => {
    assert.equal(evaluate('0.51.0', '<0.52.0'), 'in_range');
    assert.equal(evaluate('0.52.0', '<0.52.0'), 'out_of_range');
  });

  it('evaluates a two-sided range', () => {
    assert.equal(evaluate('8.0.0', '>=7.69.0 <8.17.0'), 'in_range');
    assert.equal(evaluate('7.68.0', '>=7.69.0 <8.17.0'), 'out_of_range');
    assert.equal(evaluate('8.17.0', '>=7.69.0 <8.17.0'), 'out_of_range');
    assert.equal(evaluate('7.69.0', '>=7.69.0 <8.17.0'), 'in_range', 'lower bound is inclusive');
  });

  it('evaluates inclusive and exact operators', () => {
    assert.equal(evaluate('1.2.3', '<=1.2.3'), 'in_range');
    assert.equal(evaluate('1.2.3', '=1.2.3'), 'in_range');
    assert.equal(evaluate('1.2.4', '=1.2.3'), 'out_of_range');
  });

  // The rule that keeps the product honest: an expression we cannot read is
  // never resolved by defaulting. "Matches" would invent false positives;
  // "does not match" would silently hide real exposure.
  it('returns indeterminate rather than defaulting either way', () => {
    assert.equal(evaluate('1.0.0', 'somewhere around 2'), 'indeterminate');
    assert.equal(evaluate('1.0.0', ''), 'indeterminate');
    assert.equal(evaluateVersionRange(parseVersion('unknown'), '<2.0.0'), 'indeterminate');
  });
});

describe('product name normalisation', () => {
  it('strips a version the banner glued on', () => {
    assert.equal(normaliseProductName('Apache/2.4.49'), 'apache');
    assert.equal(normaliseProductName('nginx/1.18.0'), 'nginx');
  });

  it('maps banner names to their CPE product names', () => {
    assert.ok(candidateProductNames('Apache').includes('http_server'));
    assert.ok(candidateProductNames('OpenSSH').includes('openssh'));
  });

  it('falls through conservatively for unknown products', () => {
    assert.deepEqual(candidateProductNames('some-daemon'), ['some-daemon']);
    assert.deepEqual(candidateProductNames(null), []);
  });
});

describe('matchServiceToCpe', () => {
  const apacheCpe = {
    cpe: 'cpe:2.3:a:apache:http_server:*:*:*:*:*:*:*:*',
    versionRange: '>=2.4.49 <2.4.51',
  };

  it('matches an affected version and says why', () => {
    const result = matchServiceToCpe(
      { product: 'Apache', serviceName: 'http', version: '2.4.49' },
      apacheCpe,
    );
    assert.equal(result.matched, true);
    assert.equal(result.confidence, 0.7);
    assert.ok(result.reasons.includes('exact_version_in_range'));
    assert.match(result.explanation, /falls inside the affected range/);
  });

  it('does not match a fixed version', () => {
    const result = matchServiceToCpe(
      { product: 'Apache', serviceName: 'http', version: '2.4.51' },
      apacheCpe,
    );
    assert.equal(result.matched, false);
  });

  it('does not match a different product', () => {
    const result = matchServiceToCpe(
      { product: 'nginx', serviceName: 'http', version: '2.4.49' },
      apacheCpe,
    );
    assert.equal(result.matched, false);
  });

  /**
   * The most important case in this file. A Debian/Ubuntu package keeps the
   * upstream version and backports the fix, so the banner says "vulnerable"
   * while the host is patched. Reporting that at full confidence is how an
   * uncredentialed scanner earns a reputation for crying wolf.
   */
  it('halves confidence and explains itself when a distribution revision is present', () => {
    const result = matchServiceToCpe(
      { product: 'Apache', serviceName: 'http', version: '2.4.49-1ubuntu1.3' },
      apacheCpe,
    );
    assert.equal(result.matched, true);
    assert.equal(result.confidence, 0.4);
    assert.ok(result.reasons.includes('vendor_revision_backport_possible'));
    assert.match(result.explanation, /backport/i);
    assert.match(result.explanation, /may already be patched/i);
  });

  it('reports a product-only match at low confidence when no version was seen', () => {
    const result = matchServiceToCpe(
      { product: 'Apache', serviceName: 'http', version: null },
      apacheCpe,
    );
    assert.equal(result.matched, true);
    assert.equal(result.confidence, 0.2);
    assert.ok(result.reasons.includes('product_only_no_version'));
  });

  it('reports an unparseable version at low confidence rather than dropping or asserting it', () => {
    const result = matchServiceToCpe(
      { product: 'Apache', serviceName: 'http', version: '(Debian)' },
      apacheCpe,
    );
    assert.equal(result.matched, true);
    assert.equal(result.confidence, 0.25);
    assert.ok(result.reasons.includes('version_unparseable'));
  });

  it('honours a CPE that pins an exact version', () => {
    const pinned = { cpe: 'cpe:2.3:a:apache:http_server:2.4.49:*:*:*:*:*:*:*', versionRange: null };
    assert.equal(
      matchServiceToCpe({ product: 'Apache', serviceName: null, version: '2.4.49' }, pinned)
        .confidence,
      0.7,
    );
    assert.equal(
      matchServiceToCpe({ product: 'Apache', serviceName: null, version: '2.4.50' }, pinned)
        .matched,
      false,
    );
  });

  it('never returns full confidence — a banner is evidence, not proof (QA-00)', () => {
    const result = matchServiceToCpe(
      { product: 'Apache', serviceName: 'http', version: '2.4.49' },
      apacheCpe,
    );
    assert.ok(result.confidence < 1, 'an uncredentialed match must never claim certainty');
  });

  it('survives hostile and malformed banner input without throwing (SEC-17)', () => {
    const hostile = ['<script>alert(1)</script>', "'; DROP TABLE issues; --", ' ', 'A'.repeat(5000)];
    for (const value of hostile) {
      assert.doesNotThrow(() =>
        matchServiceToCpe({ product: value, serviceName: value, version: value }, apacheCpe),
      );
    }
  });
});

describe('matchServiceToVulnerability', () => {
  it('returns the strongest match rather than the first listed', () => {
    const observed = { product: 'curl', serviceName: null, version: '8.0.0' };
    const result = matchServiceToVulnerability(observed, [
      // Weaker: product-only wildcard with an unreadable range.
      { cpe: 'cpe:2.3:a:haxx:curl:*:*:*:*:*:*:*:*', versionRange: 'unreadable' },
      // Stronger: a real range this version falls inside.
      { cpe: 'cpe:2.3:a:haxx:curl:*:*:*:*:*:*:*:*', versionRange: '>=7.69.0 <8.17.0' },
    ]);
    assert.equal(result.confidence, 0.7);
    assert.ok(result.reasons.includes('exact_version_in_range'));
  });

  it('returns no match when nothing applies', () => {
    const result = matchServiceToVulnerability(
      { product: 'nginx', serviceName: null, version: '1.18.0' },
      [{ cpe: 'cpe:2.3:a:haxx:curl:*:*:*:*:*:*:*:*', versionRange: '<8.17.0' }],
    );
    assert.equal(result.matched, false);
    assert.equal(result.confidence, 0);
  });
});
