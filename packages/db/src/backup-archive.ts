import { createCipheriv, createDecipheriv, randomBytes, scryptSync, createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

/**
 * DATA-05's archive format: "one consistent encrypted archive of database,
 * blob store, and configuration."
 *
 * Defined here, in one place, so the writer (apps/worker) and the reader
 * (apps/api's restore CLI) cannot disagree about it. A backup format where
 * the two halves are implemented separately is a backup you discover is
 * unreadable during an incident.
 *
 * Layout:
 *
 *   magic      8 bytes   "XENITEXB"
 *   version    1 byte    format version
 *   saltLen    1 byte
 *   salt       N bytes   scrypt salt
 *   ivLen      1 byte
 *   iv         N bytes   AES-GCM nonce
 *   tagLen     1 byte
 *   authTag    N bytes   AES-GCM authentication tag
 *   payload    rest      AES-256-GCM(gzip(JSON))
 *
 * AES-GCM rather than AES-CBC: a backup is restored into a security
 * appliance, so silently accepting a tampered archive would be worse than
 * failing to restore at all. GCM authenticates, so a modified archive fails
 * to decrypt instead of quietly restoring attacker-chosen rows.
 */

const MAGIC = Buffer.from('XENITEXB', 'ascii');
export const ARCHIVE_FORMAT_VERSION = 1;

const SALT_BYTES = 16;
const IV_BYTES = 12; // 96-bit nonce, the size GCM is specified for
const KEY_BYTES = 32;
const SCRYPT_COST = 2 ** 15;

export interface BackupManifest {
  readonly formatVersion: number;
  readonly createdAt: string;
  /** Highest applied migration, so a restore can refuse a schema it predates. */
  readonly schemaVersion: string;
  readonly applianceVersion: string;
  /** Row counts per table, for the post-restore verification the runbook asks for. */
  readonly tableCounts: Readonly<Record<string, number>>;
  readonly blobCount: number;
  readonly blobBytes: number;
}

export interface BackupPayload {
  readonly manifest: BackupManifest;
  /** Table name -> rows, in dependency order so a restore can insert without deferring constraints. */
  readonly tables: Readonly<Record<string, readonly Record<string, unknown>[]>>;
  /** Blob-store key -> base64 contents. Evidence (DATA-01) is part of the backup, not an optional extra. */
  readonly blobs: Readonly<Record<string, string>>;
  /** Non-secret configuration. Secrets are deliberately excluded — see `redactedConfigKeys`. */
  readonly configuration: Readonly<Record<string, unknown>>;
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  // scrypt with a high cost: a backup archive is a long-lived artifact that
  // may be copied to removable media, so it must remain expensive to attack
  // offline long after it was written.
  return scryptSync(passphrase, salt, KEY_BYTES, {
    N: SCRYPT_COST,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
}

export function encodeArchive(payload: BackupPayload, passphrase: string): Buffer {
  if (!passphrase || passphrase.length < 12) {
    throw new Error('Backup passphrase must be at least 12 characters.');
  }
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = deriveKey(passphrase, salt);

  const compressed = gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'), { level: 9 });
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([
    MAGIC,
    Buffer.from([ARCHIVE_FORMAT_VERSION]),
    Buffer.from([salt.length]),
    salt,
    Buffer.from([iv.length]),
    iv,
    Buffer.from([authTag.length]),
    authTag,
    ciphertext,
  ]);
}

export function decodeArchive(archive: Buffer, passphrase: string): BackupPayload {
  if (archive.length < MAGIC.length + 4 || !archive.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('Not a Xenitex backup archive (bad magic header).');
  }
  let offset = MAGIC.length;
  const version = archive[offset]!;
  offset += 1;
  if (version !== ARCHIVE_FORMAT_VERSION) {
    throw new Error(
      `Unsupported backup format version ${version}; this appliance reads version ${ARCHIVE_FORMAT_VERSION}.`,
    );
  }

  const readBlock = (): Buffer => {
    const length = archive[offset]!;
    offset += 1;
    const block = archive.subarray(offset, offset + length);
    offset += length;
    return block;
  };

  const salt = readBlock();
  const iv = readBlock();
  const authTag = readBlock();
  const ciphertext = archive.subarray(offset);

  const decipher = createDecipheriv('aes-256-gcm', deriveKey(passphrase, salt), iv);
  decipher.setAuthTag(authTag);

  let compressed: Buffer;
  try {
    compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    // GCM cannot tell "wrong key" from "modified archive" — both fail the
    // tag check. Say both, rather than guessing and sending the operator
    // down the wrong path during a restore.
    throw new Error(
      'Could not decrypt the archive. Either the passphrase is wrong, or the file has been altered or corrupted since it was written.',
    );
  }

  return JSON.parse(gunzipSync(compressed).toString('utf8')) as BackupPayload;
}

export function archiveChecksum(archive: Buffer): string {
  return createHash('sha256').update(archive).digest('hex');
}

/**
 * Configuration keys whose VALUES never enter a backup.
 *
 * A backup is copied off the appliance by definition — to removable media,
 * a file share, a colleague's laptop. Putting the database password or the
 * TLS private key inside it turns every copy of the backup into a copy of
 * the appliance's credentials (SEC-05). The restore runbook has the
 * operator supply these separately, which also means a stolen archive is
 * not sufficient to stand up a working clone.
 */
export const REDACTED_CONFIG_KEYS: readonly string[] = [
  'DATABASE_URL',
  'REDIS_URL',
  'SESSION_COOKIE_SECRET',
  'BACKUP_PASSPHRASE',
  'XENITEX_APP_PASSWORD',
  'XENITEX_RETENTION_WORKER_PASSWORD',
  'POSTGRES_PASSWORD',
];

export function redactConfiguration(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith('XENITEX_') && !ALLOWED_CONFIG_KEYS.includes(key)) continue;
    out[key] = REDACTED_CONFIG_KEYS.includes(key) ? '<redacted>' : value;
  }
  return out;
}

const ALLOWED_CONFIG_KEYS: readonly string[] = [
  'API_HOST',
  'API_PORT',
  'BLOB_STORE_ROOT',
  'ORG_TIMEZONE',
  'MFA_ENFORCEMENT',
  'TRUSTED_PROXY_CIDRS',
  'SESSION_IDLE_TIMEOUT_MINUTES',
  'SESSION_ABSOLUTE_TIMEOUT_HOURS',
  'WORKER_POLL_INTERVAL_MS',
];

/**
 * Every table in the backup, in an order that satisfies foreign keys on
 * insert. Restore walks this forwards and deletes it backwards.
 *
 * Listed explicitly rather than discovered from the catalogue: a table
 * added later must be a deliberate decision about whether it belongs in a
 * backup, not something that silently starts or stops being included.
 */
export const BACKUP_TABLE_ORDER: readonly string[] = [
  // Controlled vocabularies and singletons first: they have no dependencies
  // of their own and other tables reference them.
  'false_positive_reasons',
  'users',
  'organization_settings',
  'feature_flags',
  'intel_settings',
  'identity_resolution_policies',
  'risk_scoring_policies',
  'sla_policies',
  'authorized_scopes',
  'exclusion_rules',
  'scan_profiles',
  'pacing_ceilings',
  'fragile_device_rules',
  'blackout_windows',
  'scan_schedules',
  'scanner_adapters',
  'vulnerability_data_imports',
  'vulnerabilities',
  'vulnerability_cpes',
  'remediation_guidance',
  'assets',
  'asset_identity_keys',
  'asset_address_history',
  'asset_hostname_history',
  'asset_services',
  'asset_groups',
  'asset_group_members',
  'asset_merge_events',
  'scan_plan_previews',
  'scan_runs',
  'scan_run_targets',
  'raw_artifacts',
  'observations',
  'issues',
  'issue_observations',
  'verification_scans',
  'issue_state_history',
  'exceptions',
  'issue_risk_score_snapshots',
  'reports',
  'notification_channels',
  'notification_events',
  'retention_policies',
  'backup_records',
  'saved_views',
  'global_stop_events',
  'audit_entries',
];

/**
 * Tables deliberately EXCLUDED, with the reason.
 *
 * `sessions` and `mfa_recovery_codes` are live authentication state. A
 * restore that brought back sessions would resurrect logins that were
 * revoked after the backup was taken — including, in the incident case the
 * restore runbook is written for, an attacker's session.
 */
export const EXCLUDED_TABLES: Readonly<Record<string, string>> = {
  sessions: 'Live authentication state; restoring it would resurrect revoked logins.',
  mfa_recovery_codes: 'Single-use secrets; restoring spent codes would make them valid again.',
  auth_events: 'High-volume, non-authoritative telemetry; the audit log is the record of record.',
  schema_migrations: 'Owned by the migration runner, not by application data.',
};
