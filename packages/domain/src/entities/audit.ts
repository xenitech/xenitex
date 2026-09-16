import type { SessionId, UserId, UtcTimestamp } from '../primitives.js';

/**
 * DATA-02/DATA-03. Append-only, hash-chained. entryHash is computed over
 * (canonicalPayload, prevEntryHash) — see docs/adr/0007-schema-conventions.md
 * for the exact canonicalisation rule (stable key ordering, no floats).
 * There is deliberately no update/delete method on the repository interface
 * for this entity anywhere in the codebase.
 */
export interface AuditEntry {
  readonly id: number; // BIGSERIAL — chain order is guaranteed by the DB sequence, not a client clock
  readonly actorUserId: UserId | null; // null for system-initiated actions
  readonly sessionId: SessionId | null;
  readonly sourceAddress: string | null;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly beforeState: Record<string, unknown> | null;
  readonly afterState: Record<string, unknown> | null;
  readonly outcome: 'success' | 'failure' | 'denied';
  readonly occurredAt: UtcTimestamp;
  readonly canonicalPayload: Record<string, unknown>;
  readonly prevEntryHash: string;
  readonly entryHash: string;
}

export interface AuditChainVerificationResult {
  readonly verifiedUpToId: number;
  readonly gapsDetected: readonly { readonly afterId: number; readonly expectedNextId: number }[];
  readonly hashMismatches: readonly { readonly id: number }[];
  readonly isIntact: boolean;
}

export interface AuditLog {
  append(entry: Omit<AuditEntry, 'id' | 'entryHash' | 'prevEntryHash'>): Promise<AuditEntry>;
  /** DATA-02: detects tampering and gaps. Walks the chain id ASC recomputing hashes. */
  verifyChain(): Promise<AuditChainVerificationResult>;
}
