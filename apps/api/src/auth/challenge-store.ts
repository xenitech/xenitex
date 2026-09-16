import { randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';

/**
 * Ephemeral, single-use tokens (MFA sign-in challenges, TOTP enrolment in
 * progress) live in Redis with a TTL rather than a Postgres table — there is
 * nothing here worth retaining past a few minutes, and Redis's native
 * expiry is simpler and more honest than a table this code would otherwise
 * have to remember to sweep.
 */
const MFA_CHALLENGE_TTL_SECONDS = 5 * 60;
const MFA_ENROLLMENT_TTL_SECONDS = 10 * 60;

function key(prefix: string, token: string): string {
  return `xenitex:${prefix}:${token}`;
}

export async function createMfaChallenge(redis: Redis, userId: string): Promise<string> {
  const token = randomBytes(24).toString('base64url');
  await redis.set(key('mfa-challenge', token), userId, 'EX', MFA_CHALLENGE_TTL_SECONDS);
  return token;
}

/** Single-use: resolving a challenge consumes it, so a captured/replayed challenge token can't be reused. */
export async function consumeMfaChallenge(redis: Redis, token: string): Promise<string | null> {
  const userId = await redis.get(key('mfa-challenge', token));
  if (!userId) return null;
  await redis.del(key('mfa-challenge', token));
  return userId;
}

export interface PendingEnrollment {
  readonly userId: string;
  readonly secretBase32: string;
}

export async function createPendingEnrollment(
  redis: Redis,
  userId: string,
  secretBase32: string,
): Promise<string> {
  const token = randomBytes(24).toString('base64url');
  await redis.set(
    key('mfa-enroll', token),
    JSON.stringify({ userId, secretBase32 }),
    'EX',
    MFA_ENROLLMENT_TTL_SECONDS,
  );
  return token;
}

export async function consumePendingEnrollment(
  redis: Redis,
  token: string,
): Promise<PendingEnrollment | null> {
  const raw = await redis.get(key('mfa-enroll', token));
  if (!raw) return null;
  await redis.del(key('mfa-enroll', token));
  return JSON.parse(raw) as PendingEnrollment;
}
