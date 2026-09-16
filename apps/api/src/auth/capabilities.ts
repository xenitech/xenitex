import type { UserRoleEnum } from '@xenitex/db';

const ROLE_RANK: Record<UserRoleEnum, number> = {
  viewer: 0,
  analyst: 1,
  operator: 2,
  administrator: 3,
};

/** P1-23: server-computed UI capability payload — cosmetic only, SEC-13 enforces server-side on every endpoint regardless. Mirrors the same key set apps/web already renders against. */
export function capabilitiesFor(role: UserRoleEnum): Record<string, boolean> {
  const atLeast = (required: UserRoleEnum) => ROLE_RANK[role] >= ROLE_RANK[required];
  return {
    'assets.write': atLeast('analyst'),
    'issues.write': atLeast('analyst'),
    'exceptions.request': atLeast('analyst'),
    'exceptions.approve': atLeast('operator'),
    'scans.create': atLeast('operator'),
    'scans.globalStop': atLeast('operator'),
    'scopes.write': atLeast('operator'),
    'notifications.write': atLeast('operator'),
    'riskScoring.write': atLeast('administrator'),
    'slaPolicies.write': atLeast('administrator'),
    'users.write': atLeast('administrator'),
    'retention.write': atLeast('administrator'),
    'featureFlags.write': atLeast('administrator'),
  };
}

/** SEC-13: the actual server-side enforcement `capabilitiesFor` is cosmetic cover for — every route handler that mutates state calls this, never trusts the client. */
export function requireRole(actualRole: UserRoleEnum, requiredRole: UserRoleEnum): boolean {
  return ROLE_RANK[actualRole] >= ROLE_RANK[requiredRole];
}
