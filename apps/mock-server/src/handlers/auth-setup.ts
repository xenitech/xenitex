import type { AppState } from '../app-state.js';
import { Problems } from '../problem.js';
import type { MockHandler } from './generic.js';
import { sendProblem } from './generic.js';
import {
  MOCK_PASSWORD,
  MOCK_TOTP_CODE,
  SESSION_COOKIE,
  createMfaChallenge,
  createSession,
  currentUserPayload,
  resolveMfaChallenge,
  resolveSessionUserId,
  revokeSession,
} from './sessions.js';

export function buildAuthSetupHandlers(state: AppState): Record<string, MockHandler> {
  /**
   * In-memory, mutated by the handlers below as the wizard progresses.
   * Defaults to "already run" (matches the seeded org) unless
   * `MOCK_SERVER_SETUP_INCOMPLETE=true`, in which case Step 3's actual
   * setup screens (P1-06) have a real incomplete wizard to walk through
   * rather than always seeing a pre-completed org.
   */
  const setupStatus = {
    administratorCreated: !state.config.setupIncomplete,
    organizationConfigured: !state.config.setupIncomplete,
    tlsConfigured: !state.config.setupIncomplete,
    initialScopeDeclared: !state.config.setupIncomplete,
    safetyAcknowledged: !state.config.setupIncomplete,
    setupCompleted: !state.config.setupIncomplete,
  };

  return {
    login: (c, _req, reply) => {
      const body = c.request.requestBody as { email?: string; password?: string };
      const user = state.users.all().find((u) => u.email === body?.email);
      if (!user || body?.password !== MOCK_PASSWORD || !user.isActive) {
        return sendProblem(reply, Problems.unauthorized());
      }
      if (user.mfaEnabled) {
        const challengeToken = createMfaChallenge(user.id);
        return reply.code(200).send({ mfaRequired: true, challengeToken });
      }
      const token = createSession(user.id);
      reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'strict', path: '/' });
      reply.code(200).send(currentUserPayload(user));
    },

    completeMfaChallenge: (c, _req, reply) => {
      const body = c.request.requestBody as { challengeToken?: string; code?: string };
      const userId = body?.challengeToken ? resolveMfaChallenge(body.challengeToken) : undefined;
      if (!userId || body?.code !== MOCK_TOTP_CODE)
        return sendProblem(reply, Problems.unauthorized());
      const user = state.users.get(userId);
      if (!user) return sendProblem(reply, Problems.unauthorized());
      const token = createSession(user.id);
      reply.setCookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'strict', path: '/' });
      reply.code(200).send(currentUserPayload(user));
    },

    enrollMfa: (_c, _req, reply) => {
      reply.code(200).send({
        enrollmentToken: `enroll-${Math.random().toString(36).slice(2)}`,
        secret: 'MOCKSECRETBASE32TOTP',
        qrCodeUri:
          'otpauth://totp/Xenitex:mock@pilot-customer.example?secret=MOCKSECRETBASE32TOTP&issuer=Xenitex',
      });
    },

    confirmMfaEnrollment: (c, _req, reply) => {
      const body = c.request.requestBody as { code?: string };
      if (body?.code !== MOCK_TOTP_CODE)
        return sendProblem(reply, Problems.validationFailed('Incorrect TOTP code.'));
      reply.code(200).send({
        recoveryCodes: Array.from({ length: 8 }, () => Math.random().toString(36).slice(2, 10)),
      });
    },

    logout: (_c, req, reply) => {
      revokeSession(req.cookies?.[SESSION_COOKIE]);
      reply.clearCookie(SESSION_COOKIE, { path: '/' });
      reply.code(204).send();
    },

    changePassword: (_c, req, reply) => {
      const userId = resolveSessionUserId(req.cookies?.[SESSION_COOKIE]);
      const user = userId ? state.users.get(userId) : undefined;
      if (user?.mustChangePassword) {
        state.users.set({ ...user, mustChangePassword: false });
      }
      reply.code(204).send();
    },

    getCurrentSession: (_c, req, reply) => {
      const userId = resolveSessionUserId(req.cookies?.[SESSION_COOKIE]);
      const user = userId ? state.users.get(userId) : undefined;
      if (!user) return sendProblem(reply, Problems.unauthorized());
      reply.code(200).send(currentUserPayload(user));
    },

    getSetupStatus: (_c, _req, reply) => reply.code(200).send(setupStatus),

    createSetupAdministrator: (c, _req, reply) => {
      const body = c.request.requestBody as {
        email?: string;
        displayName?: string;
        password?: string;
      };
      if (state.users.all().some((u) => u.email === body?.email)) {
        return sendProblem(
          reply,
          Problems.conflict('user.email_taken', 'A user with this email already exists.'),
        );
      }
      const user = {
        id: `user-${Math.random().toString(36).slice(2)}`,
        email: body?.email ?? '',
        displayName: body?.displayName ?? '',
        role: 'administrator' as const,
        mfaEnabled: false,
        isActive: true,
        createdAt: new Date().toISOString(),
        mustChangePassword: false,
      };
      state.users.set(user);
      setupStatus.administratorCreated = true;
      reply.code(201).send(user);
    },

    setSetupOrganization: (_c, _req, reply) => {
      setupStatus.organizationConfigured = true;
      reply.code(204).send();
    },
    setSetupTls: (_c, _req, reply) => {
      setupStatus.tlsConfigured = true;
      reply.code(204).send();
    },
    createSetupInitialScope: (c, _req, reply) => {
      const body = c.request.requestBody as {
        name?: string;
        cidrRanges?: string[];
        hostnames?: string[];
        attestationType?: string;
        attestationDetails?: string;
      };
      const scope = {
        id: `scope-${Math.random().toString(36).slice(2)}`,
        name: body?.name ?? '',
        cidrRanges: body?.cidrRanges ?? [],
        hostnames: body?.hostnames ?? [],
        attestationType: (body?.attestationType ?? 'self_attested_owner') as 'self_attested_owner',
        attestationDetails: body?.attestationDetails ?? '',
        acceptedByUserId: state.adminUserId(),
        acceptedAt: new Date().toISOString(),
      };
      state.authorizedScopes.set(scope);
      setupStatus.initialScopeDeclared = true;
      reply.code(201).send(scope);
    },
    acknowledgeSetupSafetyDefaults: (_c, _req, reply) => {
      setupStatus.safetyAcknowledged = true;
      reply.code(204).send();
    },
    completeSetup: (_c, _req, reply) => {
      if (
        !setupStatus.administratorCreated ||
        !setupStatus.organizationConfigured ||
        !setupStatus.tlsConfigured ||
        !setupStatus.initialScopeDeclared ||
        !setupStatus.safetyAcknowledged
      ) {
        return sendProblem(
          reply,
          Problems.conflict('setup.incomplete', 'All setup steps must be completed first.'),
        );
      }
      setupStatus.setupCompleted = true;
      reply.code(204).send();
    },
  };
}
