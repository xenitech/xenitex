/**
 * IPv4-only CIDR expansion for scan-plan target computation (SAFE-08).
 * Bounded at MAX_EXPANDED_ADDRESSES so a plan preview can't try to
 * materialize an unbounded target list synchronously -- PERF-03 anchors
 * the largest realistic single scope at a /16 (65,536 addresses).
 */
export const MAX_EXPANDED_ADDRESSES = 65_536;

function ipToInt(ip: string): number {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    throw new Error(`Invalid IPv4 address: ${ip}`);
  }
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
}

function intToIp(value: number): string {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 0xff).join('.');
}

export interface CidrExpansionResult {
  readonly addresses: readonly string[];
  readonly truncated: boolean;
}

/** Excludes network/broadcast addresses for prefixes shorter than /31, matching how a scanner would actually enumerate hosts. */
export function expandCidr(cidr: string): CidrExpansionResult {
  const [base, prefixStr] = cidr.split('/');
  const prefix = Number(prefixStr);
  if (!base || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    throw new Error(`Invalid CIDR range: ${cidr}`);
  }
  const baseInt = ipToInt(base);
  const hostBits = 32 - prefix;
  const size = hostBits === 32 ? 0x100000000 : 1 << hostBits;
  const network = hostBits === 32 ? 0 : (baseInt & (~0 << hostBits)) >>> 0;

  if (prefix >= 31) {
    const addresses: string[] = [];
    for (let i = 0; i < size; i++) addresses.push(intToIp((network + i) >>> 0));
    return { addresses, truncated: false };
  }

  const usableSize = size - 2; // exclude network + broadcast
  const truncated = usableSize > MAX_EXPANDED_ADDRESSES;
  const count = Math.min(usableSize, MAX_EXPANDED_ADDRESSES);
  const addresses: string[] = [];
  for (let i = 1; i <= count; i++) addresses.push(intToIp((network + i) >>> 0));
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
