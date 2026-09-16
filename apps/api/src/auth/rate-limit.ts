import type { Redis } from 'ioredis';

/** SEC-11: rate limiting keyed by source address, independent of the per-account lockout below (which is keyed by account). */
const LOGIN_ATTEMPTS_PER_WINDOW = 10;
const LOGIN_WINDOW_SECONDS = 60;

export async function isSourceAddressRateLimited(
  redis: Redis,
  sourceAddress: string,
): Promise<boolean> {
  const key = `xenitex:login-attempts:${sourceAddress}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, LOGIN_WINDOW_SECONDS);
  return count > LOGIN_ATTEMPTS_PER_WINDOW;
}

/** SEC-11: account-keyed lockout, backed by `users.failed_login_count`/`locked_until` — separate mechanism from the IP-keyed limiter above. */
export const ACCOUNT_LOCKOUT_THRESHOLD = 5;
export const ACCOUNT_LOCKOUT_DURATION_MINUTES = 15;
