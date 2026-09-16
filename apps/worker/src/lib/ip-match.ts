/** Same IPv4 integer conversion as apps/api/src/lib/cidr.ts, duplicated rather than imported across the app boundary (SEC-03: worker has no dependency on apps/api). */
function ipToInt(ip: string): number | null {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return null;
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
}

export function isIpInCidr(ip: string, cidr: string): boolean {
  const [base, prefixStr] = cidr.split('/');
  const prefix = Number(prefixStr);
  if (!base || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
  const ipInt = ipToInt(ip);
  const baseInt = ipToInt(base);
  if (ipInt === null || baseInt === null) return false;
  const hostBits = 32 - prefix;
  const mask = hostBits === 32 ? 0 : (~0 << hostBits) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

const PRIVATE_RANGES = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.0/8'];

/** No exposure-classification source exists yet (Step 4.3+) — an RFC1918/loopback address is internal by definition; anything else defaults to 'unknown' rather than guessing 'external'. */
export function isPrivateIpv4(ip: string): boolean {
  return PRIVATE_RANGES.some((range) => isIpInCidr(ip, range));
}
