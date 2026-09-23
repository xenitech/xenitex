/**
 * IPv4 address and CIDR arithmetic, shared by the scan-plan preview
 * (apps/api, SAFE-08) and the worker's pre-dispatch exclusion re-check
 * (apps/worker, SAFE-02 layer 2).
 *
 * This lives in packages/domain — which has no database, HTTP, or queue
 * dependency — rather than being copy-pasted into each app. The two used to
 * carry separate implementations of the same arithmetic on the grounds that
 * the worker must not depend on apps/api (SEC-03), which is true but does
 * not imply duplication: a safety control enforced at two layers is only
 * meaningful if both layers agree on what "inside this range" means, and
 * two copies of bit-twiddling code are exactly the thing that drifts.
 */

/** PERF-03 anchors the largest realistic single scope at a /16 (65,536 addresses). */
export const MAX_EXPANDED_ADDRESSES = 65_536;

export function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    // Number() would accept '', ' 1', '0x10' and '1e2'; a scan target list
    // is attacker-adjacent input (it comes from an operator-entered scope),
    // so the accepted shape is pinned explicitly rather than inferred.
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

export function intToIpv4(value: number): string {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 0xff).join('.');
}

export interface ParsedCidr {
  readonly network: number;
  readonly prefix: number;
  readonly size: number;
}

export function parseCidr(cidr: string): ParsedCidr | null {
  const slash = cidr.indexOf('/');
  if (slash < 0) return null;
  const base = cidr.slice(0, slash);
  const prefixText = cidr.slice(slash + 1);
  if (!/^\d{1,2}$/.test(prefixText)) return null;
  const prefix = Number(prefixText);
  if (prefix > 32) return null;
  const baseInt = ipv4ToInt(base);
  if (baseInt === null) return null;

  const hostBits = 32 - prefix;
  // `2 ** hostBits`, never `1 << hostBits`. JavaScript's `<<` coerces to a
  // SIGNED 32-bit integer, so `1 << 31` is -2147483648 — which made a /1
  // scope expand to a NEGATIVE usable size and therefore to an EMPTY target
  // list, reported as a legitimate zero-target plan rather than an error.
  const size = 2 ** hostBits;
  const mask = hostBits === 32 ? 0 : (0xffffffff << hostBits) >>> 0;
  return { network: (baseInt & mask) >>> 0, prefix, size };
}

/** O(1) containment test — the shape every hot-path exclusion check wants. */
export function isIpv4InCidr(ip: string, cidr: string): boolean {
  const parsed = parseCidr(cidr);
  if (!parsed) return false;
  const ipInt = ipv4ToInt(ip);
  if (ipInt === null) return false;
  const hostBits = 32 - parsed.prefix;
  const mask = hostBits === 32 ? 0 : (0xffffffff << hostBits) >>> 0;
  return (ipInt & mask) >>> 0 === parsed.network;
}

export interface CidrExpansionResult {
  readonly addresses: readonly string[];
  readonly truncated: boolean;
}

/**
 * Excludes network/broadcast addresses for prefixes shorter than /31,
 * matching how a scanner would actually enumerate hosts. Bounded at
 * MAX_EXPANDED_ADDRESSES so a plan preview can never materialise an
 * unbounded target list synchronously.
 */
export function expandCidr(cidr: string): CidrExpansionResult {
  const parsed = parseCidr(cidr);
  if (!parsed) throw new Error(`Invalid CIDR range: ${cidr}`);
  const { network, prefix, size } = parsed;

  if (prefix >= 31) {
    const addresses: string[] = [];
    for (let i = 0; i < size; i++) addresses.push(intToIpv4((network + i) >>> 0));
    return { addresses, truncated: false };
  }

  const usableSize = size - 2; // exclude network + broadcast
  const truncated = usableSize > MAX_EXPANDED_ADDRESSES;
  const count = Math.min(usableSize, MAX_EXPANDED_ADDRESSES);
  const addresses: string[] = [];
  for (let i = 1; i <= count; i++) addresses.push(intToIpv4((network + i) >>> 0));
  return { addresses, truncated };
}

export function expandCidrRanges(cidrRanges: readonly string[]): CidrExpansionResult {
  const seen = new Set<string>();
  let truncated = false;
  for (const range of cidrRanges) {
    const result = expandCidr(range);
    truncated = truncated || result.truncated;
    for (const address of result.addresses) {
      if (seen.size >= MAX_EXPANDED_ADDRESSES) {
        truncated = true;
        break;
      }
      seen.add(address);
    }
  }
  return { addresses: [...seen], truncated };
}

const PRIVATE_RANGES = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.0/8'];

/** An RFC1918/loopback address is internal by definition; anything else is 'unknown' rather than a guessed 'external'. */
export function isPrivateIpv4(ip: string): boolean {
  return PRIVATE_RANGES.some((range) => isIpv4InCidr(ip, range));
}
