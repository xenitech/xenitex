import type { AppState } from '../app-state.js';
import { Problems } from '../problem.js';
import {
  makeGet,
  makeListFlat,
  makeListPaginated,
  paramOf,
  sendProblem,
  type MockHandler,
} from './generic.js';

export function buildCatalogHandlers(state: AppState): Record<string, MockHandler> {
  return {
    getVulnerability: makeGet(state.vulnerabilities, 'vulnerabilityId', 'vulnerability', false),
    listVulnerabilityDataImports: makeListPaginated(() => state.vulnerabilityDataImports, {
      sortKey: (i) => i.importedAt,
      id: (i) => i.id,
    }),

    getObservation: makeGet(state.observations, 'observationId', 'observation', false),
    downloadRawArtifact: (c, _req, reply) => {
      const id = paramOf(c, 'rawArtifactId');
      const artifact = state.rawArtifacts.get(id);
      if (!artifact) return sendProblem(reply, Problems.notFound('raw_artifact'));
      reply
        .code(200)
        .header('content-type', 'application/octet-stream')
        .send(Buffer.from(`mock raw artifact bytes for ${artifact.id} (${artifact.contentType})`));
    },

    listScannerAdapters: makeListFlat(() => state.scannerAdapters),
  };
}
