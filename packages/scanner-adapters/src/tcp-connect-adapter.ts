import { connect } from 'node:net';
import {
  newId,
  untrusted,
  type BlobStore,
  type Observation,
  type RawArtifact,
  type ScanPlanPreview,
} from '@xenitex/domain';
import type {
  AdapterCapabilities,
  AdapterProgressEvent,
  EstimateResult,
  ExecutionContext,
  PlanValidationInput,
  PlanValidationResult,
  ScannerAdapter,
  TargetOutcome,
} from './scanner-adapter.js';

/**
 * P2-04. docs/licence-review.md Finding 1 (LEG-02): bundling Nmap is blocked
 * on an unresolved OEM licence, and the review's own recommendation is not
 * to default to it in the reference build until that's resolved. This is
 * licence-review.md's option 3 — build the adapter on a component with a
 * compatible licence — implemented as a plain `node:net` TCP-connect scan
 * with protocol-aware banner grabbing, which needs no third-party binary
 * and no elevated capability (see docs/adr/0008-worker-capabilities.md's
 * "Update" section for why `NET_RAW` was removed alongside this).
 *
 * SEC-12: every port ever probed comes from the two fixed lists below,
 * selected by intrusiveness — there is no code path that accepts a
 * caller-supplied port. ANTI-04: a TCP connect plus reading whatever the
 * service sends first (or one HEAD request for a handful of HTTP ports) is
 * exactly what any ordinary client of that protocol does — nothing here
 * authenticates, brute-forces, or sends a payload beyond that.
 */
const SAFE_PORTS = [21, 22, 23, 25, 53, 80, 110, 111, 135, 139, 143, 443, 445, 993, 995, 1723, 3306, 3389, 5432, 5900, 6379, 8080, 8443];
const STANDARD_PORTS = [
  ...SAFE_PORTS,
  20, 69, 79, 88, 113, 119, 123, 137, 138, 161, 162, 179, 389, 427, 465, 514, 515, 587, 631, 636,
  873, 902, 989, 990, 1025, 1080, 1433, 1521, 2049, 2121, 2375, 3000, 3128, 4444, 5000, 5060, 5061,
  5601, 5672, 5900, 5985, 5986, 6000, 6666, 6667, 7001, 8000, 8008, 8081, 8088, 8161, 8888, 9000,
  9042, 9090, 9092, 9200, 9300, 11211, 27017, 27018, 50000,
];
const PORTS_BY_INTRUSIVENESS = {
  'passive-inventory': [80],
  safe: SAFE_PORTS,
  standard: [...new Set(STANDARD_PORTS)],
} as const;

const PORT_SERVICE_NAMES: Record<number, string> = {
  21: 'ftp', 22: 'ssh', 23: 'telnet', 25: 'smtp', 53: 'domain', 80: 'http', 110: 'pop3',
  111: 'rpcbind', 135: 'msrpc', 139: 'netbios-ssn', 143: 'imap', 443: 'https', 445: 'microsoft-ds',
  993: 'imaps', 995: 'pop3s', 1723: 'pptp', 3306: 'mysql', 3389: 'ms-wbt-server', 5432: 'postgresql',
  5900: 'vnc', 6379: 'redis', 8080: 'http-proxy', 8443: 'https-alt',
};

/** Sending a plaintext HEAD request only makes sense on plaintext-HTTP-shaped ports — never on a TLS port (443/8443), where nothing would understand it. */
const HTTP_PROBE_PORTS = new Set([80, 8000, 8008, 8080, 8081, 8088, 3000, 9000, 9090]);

const CONNECT_TIMEOUT_MS = 2000;
const BANNER_WAIT_MS = 500;
const HTTP_RESPONSE_WAIT_MS = 1000;
const MAX_BANNER_BYTES = 4096;

interface PortProbeResult {
  readonly port: number;
  readonly outcome: 'open' | 'closed' | 'unreachable';
  readonly bannerBase64: string | null;
}

function probePort(host: string, port: number): Promise<PortProbeResult> {
  return new Promise((resolve) => {
    let settled = false;
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    const socket = connect({ host, port, timeout: CONNECT_TIMEOUT_MS });

    const finish = (outcome: PortProbeResult['outcome']): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      const bannerBase64 = chunks.length > 0 ? Buffer.concat(chunks).toString('base64') : null;
      resolve({ port, outcome, bannerBase64 });
    };

    const onData = (chunk: Buffer): void => {
      if (totalBytes < MAX_BANNER_BYTES) {
        chunks.push(chunk);
        totalBytes += chunk.byteLength;
      }
      finish('open');
    };

    socket.once('connect', () => {
      socket.once('data', onData);
      if (HTTP_PROBE_PORTS.has(port)) {
        const bannerTimer = setTimeout(() => {
          socket.write('HEAD / HTTP/1.0\r\nHost: scan\r\nConnection: close\r\n\r\n');
          setTimeout(() => finish('open'), HTTP_RESPONSE_WAIT_MS);
        }, BANNER_WAIT_MS);
        socket.once('data', () => clearTimeout(bannerTimer));
      } else {
        setTimeout(() => finish('open'), BANNER_WAIT_MS);
      }
    });
    socket.once('timeout', () => finish('unreachable'));
    socket.once('error', (err: NodeJS.ErrnoException) => {
      // ECONNREFUSED still proves the host is up (it actively rejected us) —
      // everything else (timeout, no route, host unreachable) does not.
      finish(err.code === 'ECONNREFUSED' ? 'closed' : 'unreachable');
    });
  });
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function splitProductVersion(text: string): [string, string | null] {
  const match = /^([A-Za-z][\w.-]*)[/_]([\w.]+)/.exec(text);
  if (!match) return [text, null];
  return [match[1]!, match[2]!];
}

interface ParsedBanner {
  readonly serviceName: string | null;
  readonly product: string | null;
  readonly version: string | null;
  readonly extraInfo: string | null;
}

/** Structured extraction only (SEC-17/P2-04/P2-05) — every returned field is later wrapped Untrusted<T> before it leaves parse(), never rendered or logged raw. */
function parseBanner(port: number, bannerBase64: string | null): ParsedBanner {
  const serviceNameGuess = PORT_SERVICE_NAMES[port] ?? null;
  if (!bannerBase64) return { serviceName: serviceNameGuess, product: null, version: null, extraInfo: null };
  const text = Buffer.from(bannerBase64, 'base64').toString('utf8');
  const firstLine = (text.split(/\r?\n/)[0] ?? '').trim().slice(0, 300);

  const ssh = /^SSH-\d\.\d-(\S+)/.exec(firstLine);
  if (ssh) {
    const [product, version] = splitProductVersion(ssh[1]!);
    return { serviceName: 'ssh', product, version, extraInfo: firstLine };
  }

  const ftp = /\((vsFTPd|ProFTPD|Pure-FTPd)\s+([\w.]+)\)/i.exec(text);
  if (ftp) return { serviceName: 'ftp', product: ftp[1]!, version: ftp[2]!, extraInfo: firstLine };

  const httpServer = /^Server:\s*([^\r\n]+)/im.exec(text);
  if (httpServer) {
    const [product, version] = splitProductVersion(httpServer[1]!.trim().split(/\s+/)[0] ?? '');
    return { serviceName: serviceNameGuess ?? 'http', product, version, extraInfo: firstLine };
  }

  const ircd = /UnrealIRCd[- ]?v?([\w.]+)?/i.exec(text);
  if (ircd) {
    return { serviceName: 'irc', product: 'UnrealIRCd', version: ircd[1] ?? null, extraInfo: firstLine };
  }

  return { serviceName: serviceNameGuess, product: null, version: null, extraInfo: firstLine || null };
}

interface HostProbeResult {
  readonly address: string;
  readonly up: boolean;
  readonly ports: readonly PortProbeResult[];
}

export class TcpConnectDiscoveryAdapter implements ScannerAdapter {
  constructor(private readonly blobStore: BlobStore) {}

  capabilities(): AdapterCapabilities {
    return {
      adapterKey: 'network-discovery',
      version: '1.0.0',
      // Banner-based version inference is meaningfully less reliable than a
      // dedicated version-detection engine — reflected here and again as a
      // hard-coded low MOD-19 confidence wherever a CVE match is created.
      fidelityRating: 0.5,
      supportedIntrusiveness: ['passive-inventory', 'safe', 'standard'],
      permittedFlags: [],
    };
  }

  async validatePlan(_input: PlanValidationInput): Promise<PlanValidationResult> {
    return { valid: true };
  }

  async estimate(input: PlanValidationInput): Promise<EstimateResult> {
    const ports = PORTS_BY_INTRUSIVENESS[input.profile.intrusiveness].length;
    return {
      targetCount: 0, // filled in by the caller from the expanded scope, not known here
      estimatedPacketVolume: ports * 2, // one SYN+ACK/RST round trip per port, roughly
      estimatedDurationSeconds: Math.ceil((ports * (CONNECT_TIMEOUT_MS + BANNER_WAIT_MS)) / 1000 / 8),
    };
  }

  async *execute(
    targets: readonly string[],
    _plan: ScanPlanPreview,
    context: ExecutionContext,
    onProgress: (event: AdapterProgressEvent) => void,
  ): AsyncIterable<TargetOutcome> {
    if (targets.length === 0) return;
    for (const target of targets) onProgress({ kind: 'target_started', target });

    const ports = PORTS_BY_INTRUSIVENESS[context.intrusiveness];
    const jobs = targets.flatMap((address) => ports.map((port) => ({ address, port })));
    // pacing.concurrentHosts * concurrentPortsPerHost bounds total in-flight
    // sockets (SAFE-04) -- capped so a misconfigured profile can't open an
    // unbounded number of connections at once regardless.
    const concurrency = Math.max(
      1,
      Math.min(context.pacing.concurrentHosts * context.pacing.concurrentPortsPerHost, 200),
    );
    const flatResults = await mapWithConcurrency(jobs, concurrency, async ({ address, port }) => ({
      address,
      result: await probePort(address, port),
    }));

    const byAddress = new Map<string, PortProbeResult[]>();
    for (const { address, result } of flatResults) {
      if (!byAddress.has(address)) byAddress.set(address, []);
      byAddress.get(address)!.push(result);
    }
    const hostResults: HostProbeResult[] = targets.map((address) => {
      const ps = byAddress.get(address) ?? [];
      return { address, up: ps.some((p) => p.outcome !== 'unreachable'), ports: ps };
    });

    const artifactBytes = Buffer.from(JSON.stringify({ hosts: hostResults }), 'utf8');
    const blobStoreKey = `raw-artifacts/${context.scanRunId}/${newId()}.json`;
    const { sha256, sizeBytes } = await this.blobStore.put(blobStoreKey, artifactBytes, 'application/json');
    const rawArtifact: RawArtifact = {
      id: newId() as RawArtifact['id'],
      scanRunId: context.scanRunId as RawArtifact['scanRunId'],
      scannerAdapterKey: this.capabilities().adapterKey,
      blobStoreKey,
      contentType: 'application/json',
      sizeBytes,
      sha256,
      capturedAt: new Date().toISOString() as RawArtifact['capturedAt'],
    };

    for (const host of hostResults) {
      onProgress({ kind: 'target_completed', target: host.address });
      yield { status: 'completed', target: host.address, rawArtifact };
    }
  }

  async parse(artifact: RawArtifact): Promise<readonly Observation[]> {
    const buffer = await this.blobStore.get(artifact.blobStoreKey);
    const { hosts } = JSON.parse(buffer.toString('utf8')) as { hosts: HostProbeResult[] };
    const observations: Observation[] = [];
    const observedAt = artifact.capturedAt;

    for (const host of hosts) {
      const openPorts = host.ports.filter((p) => p.outcome === 'open');
      if (openPorts.length === 0) {
        observations.push({
          id: newId() as Observation['id'],
          scanRunId: artifact.scanRunId,
          scannerAdapterKey: artifact.scannerAdapterKey,
          scannerAdapterVersion: '1.0.0',
          rawArtifactId: artifact.id,
          targetAddress: host.address,
          targetPort: null,
          targetProtocol: null,
          resolvedAssetId: null,
          extractedAttributes: { hostState: host.up ? 'up' : 'down' },
          untrustedEvidence: {},
          observedAt,
        });
        continue;
      }
      for (const port of openPorts) {
        const parsed = parseBanner(port.port, port.bannerBase64);
        observations.push({
          id: newId() as Observation['id'],
          scanRunId: artifact.scanRunId,
          scannerAdapterKey: artifact.scannerAdapterKey,
          scannerAdapterVersion: '1.0.0',
          rawArtifactId: artifact.id,
          targetAddress: host.address,
          targetPort: port.port,
          targetProtocol: 'tcp',
          resolvedAssetId: null,
          extractedAttributes: { hostState: 'up', portState: 'open' },
          untrustedEvidence: {
            ...(parsed.serviceName ? { serviceName: untrusted(parsed.serviceName) } : {}),
            ...(parsed.product ? { product: untrusted(parsed.product) } : {}),
            ...(parsed.version ? { version: untrusted(parsed.version) } : {}),
            ...(parsed.extraInfo ? { extraInfo: untrusted(parsed.extraInfo) } : {}),
          },
          observedAt,
        });
      }
    }
    return observations;
  }
}
