/**
 * CPE 2.3 parsing, version comparison, and service-to-vulnerability
 * matching (P2-08 / MATCH-*).
 *
 * This is the core of what the product actually sells: turning "port 443
 * said `Apache/2.4.49`" into "these specific CVEs plausibly apply, and
 * here is how sure we are." It lives in `packages/domain` because it is
 * pure — no database, no network — which is what makes it testable against
 * a corpus of real version strings rather than only against whatever the
 * pipeline happened to produce.
 *
 * Two rules shape every decision below, and they come from A.6/QA-00:
 *
 *  1. A match is a CANDIDATE, never an assertion. Uncredentialed scanning
 *     reads a banner; a banner is a claim by the target, not proof.
 *  2. When the comparison cannot be made honestly — an unparseable version,
 *     a distribution revision that may carry a backported fix — confidence
 *     goes DOWN and the reason is recorded. It never guesses, and it never
 *     silently drops the finding either.
 */

// ---------------------------------------------------------------- CPE 2.3

export interface ParsedCpe {
  /** 'a' application, 'o' operating system, 'h' hardware. */
  readonly part: string;
  readonly vendor: string;
  readonly product: string;
  /** '*' (ANY) is extremely common — the version constraint then lives in the range expression. */
  readonly version: string;
}

/**
 * CPE 2.3 formatted strings are colon-delimited with backslash-escaped
 * literal colons (`cpe:2.3:a:vendor:pro\:duct:...`), so a bare `split(':')`
 * corrupts any component containing one. Rare in practice, but a silently
 * mis-split vendor becomes a silently missed vulnerability.
 */
function splitCpeComponents(cpe: string): string[] {
  const parts: string[] = [];
  let current = '';
  for (let i = 0; i < cpe.length; i += 1) {
    const ch = cpe[i]!;
    if (ch === '\\' && i + 1 < cpe.length) {
      current += cpe[i + 1];
      i += 1;
    } else if (ch === ':') {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

export function parseCpe23(cpe: string): ParsedCpe | null {
  if (typeof cpe !== 'string') return null;
  const components = splitCpeComponents(cpe.trim());
  // cpe:2.3:part:vendor:product:version:update:edition:lang:sw_edition:target_sw:target_hw:other
  if (components.length < 6) return null;
  if (components[0] !== 'cpe' || components[1] !== '2.3') return null;
  const [, , part, vendor, product, version] = components;
  if (!part || !vendor || !product) return null;
  return {
    part,
    vendor: vendor.toLowerCase(),
    product: product.toLowerCase(),
    version: version ?? '*',
  };
}

// ------------------------------------------------------------- Versions

export interface ParsedVersion {
  /** Upstream numeric components, e.g. `2.4.49` -> [2, 4, 49]. */
  readonly segments: readonly number[];
  /** Trailing letter on the last upstream segment, e.g. OpenSSL `1.0.2k` -> 'k'. */
  readonly letter: string | null;
  /**
   * A pre-release marker (`-rc1`, `-beta2`, `-alpha`). Sorts BEFORE the
   * same version without one, per the near-universal convention.
   */
  readonly preRelease: string | null;
  /**
   * A distribution/vendor revision: `-1ubuntu1.3`, `+deb11u2`,
   * `-97.el7.centos`, `-1.fc38`. Its presence is the single most important
   * signal this file produces — see `backportSuspected`.
   */
  readonly vendorRevision: string | null;
  /** False when the string could not be understood as a version at all. */
  readonly parsed: boolean;
}

const UNPARSEABLE: ParsedVersion = {
  segments: [],
  letter: null,
  preRelease: null,
  vendorRevision: null,
  parsed: false,
};

const PRE_RELEASE = /^(rc|alpha|beta|pre|dev|snapshot|m)\d*$/i;

export function parseVersion(raw: string | null | undefined): ParsedVersion {
  if (typeof raw !== 'string') return UNPARSEABLE;
  let text = raw.trim();
  if (text === '') return UNPARSEABLE;

  // Strip an epoch (`1:2.4.49`) — it orders releases within a distribution
  // and has no meaning when comparing against an upstream CVE range.
  text = text.replace(/^\d+:/, '');

  // Split upstream from any revision. Debian uses `-`, and `+` introduces
  // a distro suffix (`1.2.3+deb11u2`); `~` introduces a pre-release that
  // sorts before the base version.
  const revisionMatch = /^([^-+~]+)([-+~].*)$/.exec(text);
  const upstream = revisionMatch ? revisionMatch[1]! : text;
  const remainder = revisionMatch ? revisionMatch[2]! : '';

  const upstreamMatch = /^v?(\d+(?:\.\d+)*)([a-z]?)$/i.exec(upstream);
  if (!upstreamMatch) return UNPARSEABLE;

  const segments = upstreamMatch[1]!.split('.').map((n) => Number.parseInt(n, 10));
  if (segments.some((n) => !Number.isFinite(n))) return UNPARSEABLE;
  const letter = upstreamMatch[2] ? upstreamMatch[2].toLowerCase() : null;

  let preRelease: string | null = null;
  let vendorRevision: string | null = null;
  if (remainder) {
    const body = remainder.slice(1);
    const firstToken = body.split(/[.+-]/)[0] ?? '';
    if (remainder.startsWith('~') || PRE_RELEASE.test(firstToken)) {
      preRelease = body;
    } else {
      vendorRevision = body;
    }
  }

  return { segments, letter, preRelease, vendorRevision, parsed: true };
}

/** Standard three-way comparison over the UPSTREAM portion only. Returns null when either side is unparseable. */
export function compareVersions(a: ParsedVersion, b: ParsedVersion): number | null {
  if (!a.parsed || !b.parsed) return null;
  const length = Math.max(a.segments.length, b.segments.length);
  for (let i = 0; i < length; i += 1) {
    // A missing segment is zero: `2.4` and `2.4.0` are the same release.
    const diff = (a.segments[i] ?? 0) - (b.segments[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  const letterA = a.letter ?? '';
  const letterB = b.letter ?? '';
  if (letterA !== letterB) return letterA < letterB ? -1 : 1;
  // A pre-release sorts before the release it precedes.
  if (a.preRelease && !b.preRelease) return -1;
  if (!a.preRelease && b.preRelease) return 1;
  return 0;
}

// --------------------------------------------------------- Range matching

export type RangeVerdict = 'in_range' | 'out_of_range' | 'indeterminate';

interface RangeBound {
  readonly operator: '<' | '<=' | '>' | '>=' | '=';
  readonly version: ParsedVersion;
}

/**
 * Parses the range expressions the intel importer stores alongside each
 * CPE — `<0.52.0`, `>=7.69.0 <8.17.0`, `=1.2.3`.
 *
 * An expression this cannot parse yields `indeterminate` rather than a
 * default of "matches" or "does not match". Defaulting either way would be
 * a guess: "matches" invents false positives, "does not match" silently
 * hides real exposure, and neither is visible to anyone afterwards.
 */
function parseRange(expression: string): RangeBound[] | null {
  const bounds: RangeBound[] = [];
  for (const token of expression.trim().split(/\s+/)) {
    if (token === '') continue;
    const match = /^(<=|>=|<|>|=)?\s*(.+)$/.exec(token);
    if (!match) return null;
    const operator = (match[1] ?? '=') as RangeBound['operator'];
    const version = parseVersion(match[2]!);
    if (!version.parsed) return null;
    bounds.push({ operator, version });
  }
  return bounds.length > 0 ? bounds : null;
}

export function evaluateVersionRange(
  observed: ParsedVersion,
  rangeExpression: string | null | undefined,
): RangeVerdict {
  // No range recorded means the CPE itself pins the version; the caller
  // handles that case, so there is nothing to evaluate here.
  if (typeof rangeExpression !== 'string' || rangeExpression.trim() === '') return 'indeterminate';
  if (!observed.parsed) return 'indeterminate';

  const bounds = parseRange(rangeExpression);
  if (!bounds) return 'indeterminate';

  for (const bound of bounds) {
    const comparison = compareVersions(observed, bound.version);
    if (comparison === null) return 'indeterminate';
    const satisfied =
      bound.operator === '<'
        ? comparison < 0
        : bound.operator === '<='
          ? comparison <= 0
          : bound.operator === '>'
            ? comparison > 0
            : bound.operator === '>='
              ? comparison >= 0
              : comparison === 0;
    if (!satisfied) return 'out_of_range';
  }
  return 'in_range';
}

// ------------------------------------------------------- Product matching

/**
 * Banner product names and CPE product names disagree constantly:
 * `Apache` vs `http_server`, `nginx` vs `nginx`, `OpenSSH` vs `openssh`.
 * These are the mappings that are unambiguous and well known. Anything not
 * listed falls through to a normalised string comparison, which is
 * conservative — it misses rather than inventing.
 */
const PRODUCT_ALIASES: Readonly<Record<string, readonly string[]>> = {
  apache: ['http_server', 'apache', 'httpd'],
  httpd: ['http_server', 'apache', 'httpd'],
  nginx: ['nginx'],
  openssh: ['openssh'],
  'openssh_server': ['openssh'],
  vsftpd: ['vsftpd'],
  proftpd: ['proftpd'],
  'pure-ftpd': ['pure-ftpd', 'pure_ftpd'],
  mysql: ['mysql', 'mysql_server'],
  mariadb: ['mariadb'],
  postgresql: ['postgresql'],
  redis: ['redis'],
  openssl: ['openssl'],
  samba: ['samba'],
  unrealircd: ['unrealircd'],
  exim: ['exim'],
  postfix: ['postfix'],
  dovecot: ['dovecot'],
  bind: ['bind'],
  lighttpd: ['lighttpd'],
  tomcat: ['tomcat'],
  jetty: ['jetty'],
  curl: ['curl', 'libcurl'],
};

export function normaliseProductName(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const normalised = raw
    .trim()
    .toLowerCase()
    // Drop a trailing version the banner glued on: `Apache/2.4.49`.
    .replace(/[/_ ]v?\d.*$/, '')
    .replace(/[^a-z0-9_-]/g, '');
  return normalised === '' ? null : normalised;
}

/** Candidate CPE product names for an observed banner product, most specific first. */
export function candidateProductNames(observedProduct: string | null | undefined): readonly string[] {
  const normalised = normaliseProductName(observedProduct);
  if (!normalised) return [];
  const aliases = PRODUCT_ALIASES[normalised];
  return aliases ? [...new Set([normalised, ...aliases])] : [normalised];
}

// -------------------------------------------------------------- Matching

export interface ObservedService {
  /** From the banner, e.g. 'Apache'. Attacker-controlled (SEC-17). */
  readonly product: string | null;
  /** Port-derived guess, e.g. 'http'. Weaker than `product`. */
  readonly serviceName: string | null;
  /** From the banner, e.g. '2.4.49'. Attacker-controlled (SEC-17). */
  readonly version: string | null;
}

export interface CpeCandidate {
  readonly cpe: string;
  readonly versionRange: string | null;
}

export type MatchReason =
  | 'exact_version_in_range'
  | 'version_pinned_exact'
  | 'vendor_revision_backport_possible'
  | 'version_unparseable'
  | 'range_unparseable'
  | 'product_only_no_version';

export interface CpeMatchResult {
  readonly matched: boolean;
  /**
   * 0–1, feeding MOD-19. Deliberately never 1.0: an uncredentialed banner
   * match is evidence, not proof, and a confidence of 1 would claim
   * otherwise (QA-00).
   */
  readonly confidence: number;
  readonly reasons: readonly MatchReason[];
  /** Human-readable, rendered in the issue's evidence panel (MOD-21). */
  readonly explanation: string;
}

const NO_MATCH: CpeMatchResult = {
  matched: false,
  confidence: 0,
  reasons: [],
  explanation: '',
};

/**
 * Decides whether an observed service plausibly falls inside a CVE's
 * affected-CPE entry, and how much to believe it.
 *
 * The confidence ladder, highest to lowest:
 *
 *  0.70  version parsed cleanly and sits inside the affected range
 *  0.70  CPE pins an exact version and the observed version equals it
 *  0.40  same, but the observed version carries a DISTRIBUTION REVISION
 *        (`2.4.49-1ubuntu1.3`). Distributions routinely backport security
 *        fixes without changing the upstream version, so the upstream
 *        number says the host is vulnerable while the package may well be
 *        patched. This is the single largest source of false positives in
 *        uncredentialed scanning and it is why `QA-00` refuses to promise a
 *        low false-positive rate.
 *  0.25  the version or the range could not be parsed — reported so a human
 *        can look, but never presented as a finding we stand behind.
 *  0.20  product matches and no version was observed at all.
 */
export function matchServiceToCpe(
  observed: ObservedService,
  candidate: CpeCandidate,
): CpeMatchResult {
  const parsedCpe = parseCpe23(candidate.cpe);
  if (!parsedCpe) return NO_MATCH;

  const productNames = candidateProductNames(observed.product ?? observed.serviceName);
  if (productNames.length === 0) return NO_MATCH;
  if (!productNames.includes(parsedCpe.product)) return NO_MATCH;

  const observedVersion = parseVersion(observed.version);

  if (!observed.version) {
    return {
      matched: true,
      confidence: 0.2,
      reasons: ['product_only_no_version'],
      explanation: `Product matches ${parsedCpe.vendor}:${parsedCpe.product}, but no version was observed, so the affected range could not be checked.`,
    };
  }

  if (!observedVersion.parsed) {
    return {
      matched: true,
      confidence: 0.25,
      reasons: ['version_unparseable'],
      explanation: `Product matches ${parsedCpe.vendor}:${parsedCpe.product}, but the observed version could not be interpreted, so the affected range could not be checked.`,
    };
  }

  // A CPE pinning a concrete version takes precedence over any range.
  if (parsedCpe.version !== '*' && parsedCpe.version !== '-' && parsedCpe.version !== '') {
    const pinned = parseVersion(parsedCpe.version);
    const comparison = compareVersions(observedVersion, pinned);
    if (comparison === null) {
      return {
        matched: true,
        confidence: 0.25,
        reasons: ['version_unparseable'],
        explanation: `Product matches, but the observed version could not be compared against the affected version ${parsedCpe.version}.`,
      };
    }
    if (comparison !== 0) return NO_MATCH;
    return withBackportPenalty(observedVersion, {
      matched: true,
      confidence: 0.7,
      reasons: ['version_pinned_exact'],
      explanation: `Observed version matches the affected version ${parsedCpe.version} exactly.`,
    });
  }

  const verdict = evaluateVersionRange(observedVersion, candidate.versionRange);
  if (verdict === 'out_of_range') return NO_MATCH;
  if (verdict === 'indeterminate') {
    return {
      matched: true,
      confidence: 0.25,
      reasons: ['range_unparseable'],
      explanation: `Product matches ${parsedCpe.vendor}:${parsedCpe.product}, but the affected range ${candidate.versionRange ?? '(none recorded)'} could not be evaluated against the observed version.`,
    };
  }

  return withBackportPenalty(observedVersion, {
    matched: true,
    confidence: 0.7,
    reasons: ['exact_version_in_range'],
    explanation: `Observed version ${observed.version} falls inside the affected range ${candidate.versionRange}.`,
  });
}

function withBackportPenalty(
  observedVersion: ParsedVersion,
  result: CpeMatchResult,
): CpeMatchResult {
  if (!observedVersion.vendorRevision) return result;
  return {
    matched: true,
    confidence: 0.4,
    reasons: [...result.reasons, 'vendor_revision_backport_possible'],
    explanation:
      `${result.explanation} The version carries a distribution revision ` +
      `(-${observedVersion.vendorRevision}); distributions commonly backport security fixes ` +
      `without changing the upstream version, so this host may already be patched. ` +
      `Confirm against the installed package version.`,
  };
}

/**
 * Best match across a CVE's affected-CPE entries. A CVE frequently lists
 * several, and the strongest one is the honest answer — taking the first
 * would make the result depend on array order in the intel feed.
 */
export function matchServiceToVulnerability(
  observed: ObservedService,
  candidates: readonly CpeCandidate[],
): CpeMatchResult {
  let best: CpeMatchResult = NO_MATCH;
  for (const candidate of candidates) {
    const result = matchServiceToCpe(observed, candidate);
    if (result.matched && result.confidence > best.confidence) best = result;
  }
  return best;
}
