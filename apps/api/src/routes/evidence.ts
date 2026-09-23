import type { FastifyInstance } from 'fastify';
import type { ApiDependencies } from '../dependencies.js';
import { appendAuditEntry } from '../audit/audit-log.js';
import { problem, requireSession, sourceAddressOf } from './auth.js';

/**
 * MOD-21: "No finding may exist in the UI without evidence a reviewer can
 * inspect." The issue detail panel has always rendered an evidence link
 * pointing at `/v1/raw-artifacts/{id}/download`, and the OpenAPI contract
 * has always documented both of these operations — but neither was
 * implemented, so every single evidence link in the product 404'd.
 *
 * WORK-07 ranks the evidence requirement second only to the B.1 safety
 * controls in what may be cut under pressure, and A.6 is explicit that
 * inspectable evidence — not a low false-positive rate — is what earns
 * trust in the pilot. An evidence link that does not resolve is therefore
 * not a cosmetic gap; it is the product failing its stated quality
 * commitment.
 */
export async function registerEvidenceRoutes(
  app: FastifyInstance,
  deps: ApiDependencies,
): Promise<void> {
  const { db } = deps;

  app.get(
    '/observations/:observationId',
    { preHandler: requireSession(deps) },
    async (request, reply) => {
      const { observationId } = request.params as { observationId: string };
      const row = await db
        .selectFrom('observations')
        .innerJoin('scanner_adapters', 'scanner_adapters.id', 'observations.scanner_adapter_id')
        .select([
          'observations.id',
          'observations.scan_run_id',
          'observations.raw_artifact_id',
          'observations.target_address',
          'observations.target_port',
          'observations.target_protocol',
          'observations.resolved_asset_id',
          'observations.extracted_attributes',
          'observations.untrusted_evidence',
          'observations.observed_at',
          'scanner_adapters.adapter_key',
          'scanner_adapters.version',
        ])
        .where('observations.id', '=', observationId)
        .executeTakeFirst();

      if (!row) {
        return reply
          .code(404)
          .type('application/problem+json')
          .send(problem(404, 'resource.not_found', 'Observation not found'));
      }

      return reply.code(200).send({
        id: row.id,
        scanRunId: row.scan_run_id,
        scannerAdapterKey: row.adapter_key,
        scannerAdapterVersion: row.version,
        rawArtifactId: row.raw_artifact_id,
        targetAddress: row.target_address,
        targetPort: row.target_port,
        targetProtocol: row.target_protocol,
        resolvedAssetId: row.resolved_asset_id,
        extractedAttributes: row.extracted_attributes,
        // SEC-17: these values came from the scanned target. They are sent
        // as JSON string values — never interpolated into markup here, and
        // never rendered as HTML by the client (see EvidenceBlock).
        untrustedEvidence: row.untrusted_evidence,
        observedAt: row.observed_at,
      });
    },
  );

  app.get(
    '/raw-artifacts/:rawArtifactId/download',
    { preHandler: requireSession(deps) },
    async (request, reply) => {
      const { rawArtifactId } = request.params as { rawArtifactId: string };
      const artifact = await db
        .selectFrom('raw_artifacts')
        .select(['id', 'blob_store_key', 'content_type', 'size_bytes', 'sha256'])
        .where('id', '=', rawArtifactId)
        .executeTakeFirst();

      if (!artifact) {
        return reply
          .code(404)
          .type('application/problem+json')
          .send(problem(404, 'resource.not_found', 'Raw artifact not found'));
      }

      let bytes: Buffer;
      try {
        bytes = await deps.blobStore.get(artifact.blob_store_key);
      } catch {
        // The row survives its blob when a retention job (DATA-04) has
        // aged the artifact out. That is a legitimate state, not a server
        // fault, and the operator needs to be told which of the two it is.
        return reply
          .code(410)
          .type('application/problem+json')
          .send(
            problem(
              410,
              'evidence.artifact_unavailable',
              'This raw artifact is no longer stored',
              'The observation record remains, but the artifact itself has been removed by the retention policy for raw artifacts.',
            ),
          );
      }

      // SEC-11/DATA-03: artifact download is an evidence export and is
      // audited as one — who pulled which raw scanner output, and when.
      const currentUser = request.currentUser!;
      await appendAuditEntry(db, {
        actorUserId: currentUser.userId,
        sessionId: currentUser.sessionId,
        sourceAddress: sourceAddressOf(request),
        action: 'raw_artifact.downloaded',
        targetType: 'raw_artifact',
        targetId: artifact.id,
        beforeState: null,
        afterState: null,
        outcome: 'success',
      });

      return (
        reply
          .code(200)
          // Always octet-stream, never the artifact's own recorded
          // content_type: the bytes are attacker-controlled scanner output
          // (SEC-17), and serving them back with a content type a browser
          // will render — text/html, image/svg+xml — turns the evidence
          // viewer into a stored-XSS delivery path against the operator
          // reviewing it. `attachment` and nosniff close the same door
          // from the other side.
          .header('Content-Type', 'application/octet-stream')
          .header('X-Content-Type-Options', 'nosniff')
          .header('Content-Disposition', `attachment; filename="${artifact.id}.bin"`)
          .header('Content-Length', String(bytes.byteLength))
          // DATA-01: artifacts are immutable, so the digest doubles as a
          // strong validator a reviewer can check the download against.
          .header('ETag', `"${artifact.sha256}"`)
          .send(bytes)
      );
    },
  );
}
