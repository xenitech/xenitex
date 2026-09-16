import type { components } from '@xenitex/contracts';
import type { AppState } from '../app-state.js';
import { Problems } from '../problem.js';
import { computeETag } from '../store.js';
import {
  checkIfMatch,
  makeGet,
  makeListFlat,
  makeListPaginated,
  nextId,
  paramOf,
  sendProblem,
  withIdempotency,
  type MockHandler,
} from './generic.js';

type User = components['schemas']['User'];

export function buildAdminHandlers(state: AppState): Record<string, MockHandler> {
  return {
    listUsers: makeListPaginated(() => state.users.all(), {
      sortKey: (u) => u.createdAt,
      id: (u) => u.id,
    }),
    getUser: makeGet(state.users, 'userId', 'user'),
    createUser: (c, req, reply) => {
      const body = c.request.requestBody as {
        email: string;
        displayName: string;
        role: User['role'];
        password: string;
      };
      if (state.users.all().some((u) => u.email === body.email)) {
        return sendProblem(
          reply,
          Problems.conflict('user.email_taken', 'A user with this email already exists.'),
        );
      }
      withIdempotency('createUser', req, reply, () => {
        const user: User = {
          id: nextId('user'),
          email: body.email,
          displayName: body.displayName,
          role: body.role,
          mfaEnabled: false,
          isActive: true,
          createdAt: new Date().toISOString(),
          // P1-07: an administrator sets the initial password, so its owner
          // must change it on first sign-in.
          mustChangePassword: true,
        };
        state.users.set(user);
        return { status: 201, body: user };
      });
    },
    updateUser: (c, req, reply) => {
      const id = paramOf(c, 'userId');
      const existing = state.users.get(id);
      if (!existing) return sendProblem(reply, Problems.notFound('user'));
      if (!checkIfMatch(reply, req, existing)) return;
      const patch = c.request.requestBody as Partial<User>;
      const updated = state.users.patch(id, patch)!;
      reply.header('etag', computeETag(updated)).code(200).send(updated);
    },
    deactivateUser: (c, _req, reply) => {
      const id = paramOf(c, 'userId');
      const existing = state.users.get(id);
      if (!existing) return sendProblem(reply, Problems.notFound('user'));
      state.users.patch(id, { isActive: false });
      reply.code(204).send();
    },

    getOrganizationSettings: (_c, _req, reply) => reply.code(200).send(state.organizationSettings),
    updateOrganizationSettings: (c, req, reply) => {
      if (!checkIfMatch(reply, req, state.organizationSettings)) return;
      state.organizationSettings = {
        ...state.organizationSettings,
        ...(c.request.requestBody as object),
      };
      reply
        .header('etag', computeETag(state.organizationSettings))
        .code(200)
        .send(state.organizationSettings);
    },

    listFeatureFlags: makeListFlat(() => state.featureFlags.all()),
    updateFeatureFlag: (c, req, reply) => {
      const key = paramOf(c, 'key');
      const existing = state.featureFlags.get(key);
      if (!existing) return sendProblem(reply, Problems.notFound('feature_flag'));
      const body = c.request.requestBody as { isEnabled: boolean };
      if (key === 'remediation_executor_enabled' && body.isEnabled) {
        return sendProblem(
          reply,
          Problems.unprocessable(
            'feature_flag.no_implementation',
            'EXT-09/PRIN-01: no RemediationExecutor implementation exists — hard-off by construction.',
          ),
        );
      }
      const updated = state.featureFlags.patch(key, {
        isEnabled: body.isEnabled,
        updatedAt: new Date().toISOString(),
      })!;
      reply.code(200).send(updated);
    },

    listRetentionPolicies: makeListFlat(() => state.retentionPolicies.all()),
    getRetentionPolicy: makeGet(state.retentionPolicies, 'dataClass', 'retention_policy'),
    updateRetentionPolicy: (c, req, reply) => {
      const dataClass = paramOf(c, 'dataClass');
      const existing = state.retentionPolicies.get(dataClass);
      if (!existing) return sendProblem(reply, Problems.notFound('retention_policy'));
      if (!checkIfMatch(reply, req, existing)) return;
      const body = c.request.requestBody as { retentionDays: number };
      if (body.retentionDays < existing.minimumFloorDays) {
        return sendProblem(
          reply,
          Problems.unprocessable(
            'retention.below_floor',
            `retentionDays must be >= ${existing.minimumFloorDays} (DATA-04).`,
          ),
        );
      }
      const updated = state.retentionPolicies.patch(dataClass, {
        retentionDays: body.retentionDays,
      })!;
      reply.header('etag', computeETag(updated)).code(200).send(updated);
    },

    listBackupRecords: makeListPaginated(() => state.backupRecords.all(), {
      sortKey: (b) => b.startedAt,
      id: (b) => b.id,
    }),
    getBackupRecord: makeGet(state.backupRecords, 'backupId', 'backup_record', false),
    createBackup: (_c, req, reply) => {
      withIdempotency('createBackup', req, reply, () => {
        const record: components['schemas']['BackupRecord'] = {
          id: nextId('backup'),
          startedAt: new Date().toISOString(),
          status: 'running',
          archiveLocation: `/var/backups/xenitex/${nextId('backup')}.tar.gz.enc`,
          encrypted: true,
        };
        state.backupRecords.set(record);
        return {
          status: 202,
          body: record,
          headers: { location: `/v1/backup-records/${record.id}` },
        };
      });
    },

    getSystemHealth: (_c, _req, reply) => {
      const queueBacklog = state.scanRuns.all().filter((r) => r.status === 'queued').length;
      reply.code(200).send({
        components: [
          { name: 'database', status: 'ok' },
          { name: 'queue', status: 'ok' },
          { name: 'blob_store', status: 'ok' },
        ],
        vulnerabilityDataAgeDays: 3,
        templateVersions: { 'network-discovery': '1.4.0', 'template-checks': '2.1.3' },
        diskHeadroomBytes: 200_000_000_000,
        diskHeadroomProjectionDays: 240,
        lastSuccessfulBackupAt: state.backupRecords.all()[0]?.completedAt ?? null,
        queueBacklog,
        degradedSubsystems: [],
      });
    },
  };
}
