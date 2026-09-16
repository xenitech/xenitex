import * as OTPAuth from 'otpauth';
import { randomBytes } from 'node:crypto';

/** SEC-09: mandatory TOTP for operator/administrator. ANTI-08: never hand-rolled — otpauth implements RFC 6238 directly. */
const ISSUER = 'Xenitex';
const RECOVERY_CODE_COUNT = 8;

export function generateTotpSecret(): string {
  return new OTPAuth.Secret({ size: 20 }).base32;
}

export function buildTotp(secretBase32: string, accountEmail: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: ISSUER,
    label: accountEmail,
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
}

export function totpProvisioningUri(secretBase32: string, accountEmail: string): string {
  return buildTotp(secretBase32, accountEmail).toString();
}

/** `window: 1` tolerates one 30s step of clock drift either side — the standard, documented TOTP tolerance. */
export function verifyTotpCode(secretBase32: string, accountEmail: string, code: string): boolean {
  const totp = buildTotp(secretBase32, accountEmail);
  return totp.validate({ token: code, window: 1 }) !== null;
}

/** SEC-09: recovery codes are issued exactly once here and stored hashed by the caller — there is no endpoint to retrieve them again later. */
export function generateRecoveryCodes(): readonly string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => randomBytes(5).toString('hex'));
}
