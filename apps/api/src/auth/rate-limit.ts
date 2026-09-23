import type { Redis } from 'ioredis';

/** SEC-11: rate limiting keyed by source address, independent of the per-account lockout below (which is keyed by account). */
const LOGIN_ATTEMPTS_PER_WINDOW = 10;
const LOGIN_WINDOW_SECONDS = 60;

/**
 * Fixed-window counter, incremented and expired in ONE round trip.
 *
 * The previous version issued `INCR`, then `EXPIRE` only when the returned
 * count was exactly 1. Two failure modes followed from that:
 *
 *  - If the process died, or the EXPIRE failed, between the two commands,
 *    the key had no TTL and lived forever — so that source address was rate
 *    limited permanently, with no way back short of manually deleting the
 *    key from Redis. Locking a legitimate operator out of their own
 *    appliance indefinitely is a worse outcome than the throttling was
 *    worth.
 *  - Two concurrent requests could both observe a count above 1 and neither
 *    would set the TTL, producing the same permanent key without any
 *    crash at all.
 *
 * A Lua script makes the increment and the expiry atomic, so the key always
 * has a TTL from the instant it exists.
 */
const INCREMENT_WITH_TTL = `
  local count = redis.call('INCR', KEYS[1])
  if count == 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
  elseif redis.call('TTL', KEYS[1]) < 0 then
    -- Self-healing: a key that somehow lost its TTL gets one back rather
    -- than blocking this source address forever.
    redis.call('EXPIRE', KEYS[1], ARGV[1])
  end
  return count
`;

export async function isSourceAddressRateLimited(
  redis: Redis,
  sourceAddress: string,
): Promise<boolean> {
  const key = `xenitex:login-attempts:${sourceAddress}`;
  try {
    const count = (await redis.eval(
      INCREMENT_WITH_TTL,
      1,
      key,
      String(LOGIN_WINDOW_SECONDS),
    )) as number;
    return count > LOGIN_ATTEMPTS_PER_WINDOW;
  } catch {
    // Fail OPEN, deliberately, and only for this control. Redis being
    // unavailable must not make the appliance unloginnable — the
    // account-keyed lockout below is backed by Postgres and still applies,
    // so brute-force protection is degraded here, not absent. The opposite
    // choice (fail closed) turns a Redis blip into a total loss of access
    // to a security appliance during an incident, which is when access
    // matters most.
    return false;
  }
}

/** SEC-11: account-keyed lockout, backed by `users.failed_login_count`/`locked_until` — separate mechanism from the IP-keyed limiter above. */
export const ACCOUNT_LOCKOUT_THRESHOLD = 5;
export const ACCOUNT_LOCKOUT_DURATION_MINUTES = 15;
