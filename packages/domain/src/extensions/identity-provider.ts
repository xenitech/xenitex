import type { UserId, UtcTimestamp } from '../primitives.js';
import type { UserRole } from '../entities/user.js';

/**
 * EXT-01. Local database is the only implementation in this release. OIDC/SAML/SCIM
 * (v1.1, Appendix) plug in here later by adding a second implementation of this
 * interface — no call site elsewhere in the codebase should need to change.
 */
export interface AuthenticatedPrincipal {
  readonly userId: UserId;
  readonly role: UserRole;
  readonly authenticatedAt: UtcTimestamp;
  readonly mfaSatisfied: boolean;
}

export type AuthenticationFailureReason =
  'invalid_credentials' | 'locked' | 'mfa_required' | 'mfa_invalid' | 'inactive_account';

export interface AuthenticationFailure {
  readonly reason: AuthenticationFailureReason;
}

export interface LocalCredentials {
  readonly email: string;
  readonly password: string;
  readonly totpCode: string | null;
}

export interface IdentityProvider {
  authenticate(
    credentials: LocalCredentials,
  ): Promise<AuthenticatedPrincipal | AuthenticationFailure>;
  /** SEC-08: invalidation on password change and role change is the caller's responsibility (session store), not this interface's. */
}

/**
 * The concrete local implementation (argon2id verification, lockout counters,
 * TOTP challenge) lives in apps/api/src — it needs the users/sessions tables and
 * therefore a database dependency this package deliberately does not have.
 */
