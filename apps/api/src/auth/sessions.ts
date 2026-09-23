import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { DB, UserRoleEnum } from '@xenitex/db';
import { newId } from '@xenitex/domain';

export interface SessionConfig {
  readonly idleTimeoutMinutes: number;
  readonly absoluteTimeoutHours: number;
}

export interface CreatedSession {
  readonly sessionId: string;
  readonly rawSessionToken: string;
  readonly rawCsrfToken: string;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

/** SEC-08: opaque server-side sessions — the cookie carries only an unguessable token; every property lives in `sessions`, never encoded into the token itself. */
export async function createSession(
  db: Kysely<DB>,
  userId: string,
  sourceAddress: string,
  userAgent: string | undefined,
  config: SessionConfig,
): Promise<CreatedSession> {
  const rawSessionToken = randomToken();
  const rawCsrfToken = randomToken();
  const now = Date.now();
  const sessionId = newId();

  await db
    .insertInto('sessions')
    .values({
      id: sessionId,
      user_id: userId,
      session_token_hash: sha256(rawSessionToken),
      csrf_token_hash: sha256(rawCsrfToken),
      source_address: sourceAddress,
      user_agent: userAgent ?? null,
      idle_expires_at: new Date(now + config.idleTimeoutMinutes * 60_000),
      absolute_expires_at: new Date(now + config.absoluteTimeoutHours * 3_600_000),
    })
    .execute();

  return { sessionId, rawSessionToken, rawCsrfToken };
}

export interface ResolvedSession {
  readonly sessionId: string;
  readonly userId: string;
  readonly csrfTokenHash: string;
  /**
   * Resolved in the same round trip as the session itself. Every
   * authorisation decision (SEC-13) and every SEC-09/P1-07 account gate
   * reads these, so fetching them here removes the per-route
   * `SELECT role FROM users` each handler used to issue independently —
   * and, more importantly, makes it impossible for a handler to forget.
   */
  readonly role: UserRoleEnum;
  readonly mfaEnabled: boolean;
  readonly mustChangePassword: boolean;
  readonly isActive: boolean;
}

/**
 * Looks up, validates expiry, and slides the idle timeout forward on every
 * successful resolution (SEC-08: idle AND absolute timeouts — sliding only
 * the former). Returns `null` for anything invalid rather than throwing:
 * an expired/unknown/revoked session is exactly the same as "not signed
 * in" from the caller's perspective.
 */
export async function resolveSession(
  db: Kysely<DB>,
  rawSessionToken: string,
  config: SessionConfig,
): Promise<ResolvedSession | null> {
  const tokenHash = sha256(rawSessionToken);
  const row = await db
    .selectFrom('sessions')
    .innerJoin('users', 'users.id', 'sessions.user_id')
    .select([
      'sessions.id as id',
      'sessions.user_id as user_id',
      'sessions.csrf_token_hash as csrf_token_hash',
      'sessions.idle_expires_at as idle_expires_at',
      'sessions.absolute_expires_at as absolute_expires_at',
      'sessions.revoked_at as revoked_at',
      'users.role as role',
      'users.mfa_enabled as mfa_enabled',
      'users.must_change_password as must_change_password',
      'users.is_active as is_active',
    ])
    .where('sessions.session_token_hash', '=', tokenHash)
    .executeTakeFirst();

  if (!row || row.revoked_at) return null;
  // A deactivated account's already-issued session used to keep working
  // until it timed out on its own — POST /users/{id}/deactivate revoked
  // nothing. Failing closed here means deactivation takes effect on the
  // deactivated user's very next request, whatever that request is.
  if (!row.is_active) return null;

  const now = new Date();
  if (now > new Date(row.idle_expires_at) || now > new Date(row.absolute_expires_at)) {
    return null;
  }

  await db
    .updateTable('sessions')
    .set({
      last_seen_at: now,
      idle_expires_at: new Date(now.getTime() + config.idleTimeoutMinutes * 60_000),
    })
    .where('id', '=', row.id)
    .execute();

  return {
    sessionId: row.id,
    userId: row.user_id,
    csrfTokenHash: row.csrf_token_hash,
    role: row.role,
    mfaEnabled: row.mfa_enabled,
    mustChangePassword: row.must_change_password,
    isActive: row.is_active,
  };
}

/**
 * Constant-time comparison (ANTI-08: no hand-rolled shortcuts on a security
 * primitive). A plain `===` on two hex digests leaks, via how long the
 * comparison takes, how many leading bytes an attacker-supplied CSRF token
 * got right — which is exactly the oracle a byte-at-a-time forgery needs.
 */
export function verifyCsrfToken(rawCsrfToken: string, expectedHash: string): boolean {
  const actual = Buffer.from(sha256(rawCsrfToken), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  if (actual.length !== expected.length || expected.length === 0) return false;
  return timingSafeEqual(actual, expected);
}

export async function revokeSession(
  db: Kysely<DB>,
  sessionId: string,
  reason: string,
): Promise<void> {
  await db
    .updateTable('sessions')
    .set({ revoked_at: new Date(), revoked_reason: reason })
    .where('id', '=', sessionId)
    .where('revoked_at', 'is', null)
    .execute();
}

/** SEC-08: invalidation on password change and role change — every other session for this user, not just the current one. */
export async function revokeAllSessionsForUser(
  db: Kysely<DB>,
  userId: string,
  reason: string,
  exceptSessionId?: string,
): Promise<void> {
  let query = db
    .updateTable('sessions')
    .set({ revoked_at: new Date(), revoked_reason: reason })
    .where('user_id', '=', userId)
    .where('revoked_at', 'is', null);
  if (exceptSessionId) {
    query = query.where('id', '!=', exceptSessionId);
  }
  await query.execute();
}
