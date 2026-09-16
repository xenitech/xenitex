import type { components } from '@xenitex/contracts';
import type { Role } from '../middleware/permissions.js';

type User = components['schemas']['User'];

interface SessionRecord {
  readonly token: string;
  readonly userId: string;
  createdAt: number;
}

/**
 * Deliberately minimal: this is a mock for Step 3 to build the auth screens
 * against (P1-07), not a preview of Step 4's real SEC-07/SEC-08/SEC-09
 * implementation (Argon2id, opaque server-side sessions, TOTP). The fixed
 * mock password and mock TOTP code below exist so a scripted E2E/manual
 * walkthrough can exercise every screen without real secrets.
 */
export const MOCK_PASSWORD = 'password123';
export const MOCK_TOTP_CODE = '000000';
export const SESSION_COOKIE = 'xenitex_mock_session';

const sessions = new Map<string, SessionRecord>();
const mfaChallenges = new Map<string, string>(); // challengeToken -> userId

export function createSession(userId: string): string {
  const token = `sess-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  sessions.set(token, { token, userId, createdAt: Date.now() });
  return token;
}

export function resolveSessionUserId(token: string | undefined): string | undefined {
  if (!token) return undefined;
  return sessions.get(token)?.userId;
}

export function revokeSession(token: string | undefined): void {
  if (token) sessions.delete(token);
}

export function createMfaChallenge(userId: string): string {
  const token = `mfa-${Math.random().toString(36).slice(2)}`;
  mfaChallenges.set(token, userId);
  return token;
}

export function resolveMfaChallenge(token: string): string | undefined {
  return mfaChallenges.get(token);
}

export function capabilitiesFor(role: Role): Record<string, boolean> {
  const rank: Record<Role, number> = { viewer: 0, analyst: 1, operator: 2, administrator: 3 };
  const gte = (r: Role) => rank[role] >= rank[r];
  return {
    'assets.write': gte('analyst'),
    'issues.write': gte('analyst'),
    'exceptions.request': gte('analyst'),
    'exceptions.approve': gte('operator'),
    'scans.create': gte('operator'),
    'scans.globalStop': gte('operator'),
    'scopes.write': gte('operator'),
    'notifications.write': gte('operator'),
    'riskScoring.write': gte('administrator'),
    'slaPolicies.write': gte('administrator'),
    'users.write': gte('administrator'),
    'retention.write': gte('administrator'),
    'featureFlags.write': gte('administrator'),
  };
}

export function currentUserPayload(user: User) {
  return { user, capabilities: capabilitiesFor(user.role) };
}
