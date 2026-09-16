import type { SessionId, UserId, UtcTimestamp } from '../primitives.js';

/** Four fixed roles for this release (anti-goal: no custom role definitions). */
export type UserRole = 'viewer' | 'analyst' | 'operator' | 'administrator';

export interface User {
  readonly id: UserId;
  readonly email: string;
  readonly displayName: string;
  readonly role: UserRole;
  /** SEC-09: mandatory for operator and administrator. */
  readonly mfaEnabled: boolean;
  readonly isActive: boolean;
  readonly createdAt: UtcTimestamp;
}

/** SEC-08. The cookie carries only the opaque token; this is the server-side record it maps to. */
export interface Session {
  readonly id: SessionId;
  readonly userId: UserId;
  readonly sourceAddress: string;
  readonly createdAt: UtcTimestamp;
  readonly idleExpiresAt: UtcTimestamp;
  readonly absoluteExpiresAt: UtcTimestamp;
  readonly revokedAt: UtcTimestamp | null;
}
