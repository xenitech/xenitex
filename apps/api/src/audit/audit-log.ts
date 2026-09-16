/**
 * Moved to @xenitex/db so apps/worker can append audit entries (FEED-22:
 * egress-window open/close is an audit event) without a second,
 * independently-computed hash chain implementation — DATA-02's chain is one
 * logical sequence and must have exactly one place that computes it. Every
 * existing `from '../audit/audit-log.js'` import in this app keeps working
 * unchanged via this re-export.
 */
export {
  appendAuditEntry,
  verifyAuditChain,
  GENESIS_HASH,
  type AuditEntryInput,
  type AuditChainVerificationResult,
} from '@xenitex/db';
