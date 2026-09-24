import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { newId, type BlobStore, type RawArtifact } from '@xenitex/domain';
import {
  parseBanner,
  parseHttpResponseFields,
  splitProductVersion,
  TcpConnectDiscoveryAdapter,
} from './tcp-connect-adapter.js';

/**
 * SEC-17/P2-04. `parseBanner` (and the HTTP-specific extraction inside it)
 * is the one place attacker-controlled bytes are turned into structured
 * fields — everything `matchConfigurationFindings` reasons about, and every
 * product/version string fed to CVE matching, passes through here first.
 * Getting this wrong either loses a real signal (a banner that says
 * something dangerous never reaches the matcher) or manufactures a false
 * one (a header that was never actually sent gets reported as present).
 */

function toBase64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64');
}

describe('parseBanner — protocol banners (unchanged behaviour)', () => {
  it('parses an SSH banner', () => {
    const parsed = parseBanner(22, toBase64('SSH-2.0-OpenSSH_8.9p1 Ubuntu-3ubuntu0.4\r\n'));
    assert.equal(parsed.serviceName, 'ssh');
    assert.equal(parsed.product, 'OpenSSH');
    assert.equal(parsed.version, '8.9p1');
  });

  it('parses a vsftpd banner', () => {
    const parsed = parseBanner(21, toBase64('220 (vsFTPd 3.0.3)\r\n'));
    assert.equal(parsed.serviceName, 'ftp');
    assert.equal(parsed.product, 'vsFTPd');
    assert.equal(parsed.version, '3.0.3');
  });

  it('returns nulls (not a throw) for an empty banner', () => {
    const parsed = parseBanner(9999, null);
    assert.equal(parsed.serviceName, null);
    assert.equal(parsed.product, null);
    assert.equal(parsed.httpStatusLine, null);
    assert.equal(parsed.httpHeadersComplete, false);
  });

  it('falls back to the port-derived service name guess with no recognisable banner', () => {
    const parsed = parseBanner(3306, toBase64('\x0a\x00\x00\x00'));
    assert.equal(parsed.serviceName, 'mysql');
    assert.equal(parsed.product, null);
  });
});

describe('parseBanner — HTTP response fields (the banner as the finding, not just a fingerprint)', () => {
  it('extracts the status line, Server-derived product, and marks headers complete', () => {
    const response = [
      'HTTP/1.1 200 OK',
      'Server: nginx/1.18.0',
      'Content-Type: text/html',
      '',
      '',
    ].join('\r\n');
    const parsed = parseBanner(80, toBase64(response));
    assert.equal(parsed.httpStatusLine, 'HTTP/1.1 200 OK');
    assert.equal(parsed.product, 'nginx');
    assert.equal(parsed.version, '1.18.0');
    assert.equal(parsed.httpHeadersComplete, true);
    assert.equal(parsed.httpLocation, null);
  });

  it('extracts a Location header on a redirect', () => {
    const response = [
      'HTTP/1.1 301 Moved Permanently',
      'Location: https://example.test/',
      '',
      '',
    ].join('\r\n');
    const parsed = parseBanner(80, toBase64(response));
    assert.equal(parsed.httpStatusLine, 'HTTP/1.1 301 Moved Permanently');
    assert.equal(parsed.httpLocation, 'https://example.test/');
  });

  it('extracts a WWW-Authenticate header', () => {
    const response = [
      'HTTP/1.1 401 Unauthorized',
      'WWW-Authenticate: Basic realm="Admin"',
      '',
      '',
    ].join('\r\n');
    const parsed = parseBanner(80, toBase64(response));
    assert.equal(parsed.httpWwwAuthenticate, 'Basic realm="Admin"');
  });

  it('marks headers incomplete when no blank-line terminator was captured', () => {
    // Simulates a response fragmented across TCP segments, or one cut off
    // by the adapter's byte cap — only the status line and part of the
    // headers arrived. Reporting a header as ABSENT from a capture like
    // this would be a guess, not an observation.
    const truncated = 'HTTP/1.1 200 OK\r\nServer: Apa';
    const parsed = parseBanner(80, toBase64(truncated));
    assert.equal(parsed.httpStatusLine, 'HTTP/1.1 200 OK');
    assert.equal(parsed.httpHeadersComplete, false);
  });

  it('accepts a bare LF-LF terminator from a non-conformant embedded HTTP stack', () => {
    const response = 'HTTP/1.0 200 OK\nServer: mini_httpd\n\n';
    const parsed = parseBanner(80, toBase64(response));
    assert.equal(parsed.httpHeadersComplete, true);
  });

  it('returns the empty HTTP shape for a non-HTTP banner', () => {
    const parsed = parseBanner(22, toBase64('SSH-2.0-OpenSSH_8.9\r\n'));
    assert.equal(parsed.httpStatusLine, null);
    assert.equal(parsed.httpLocation, null);
    assert.equal(parsed.httpWwwAuthenticate, null);
    assert.equal(parsed.httpHeadersComplete, false);
  });

  it('never throws on a malformed or hostile response (SEC-17)', () => {
    const hostile = [
      'HTTP/1.1 200 OK\r\nServer: <script>alert(1)</script>\r\n\r\n',
      'HTTP/1.1 200 OK\r\nLocation: ' + 'A'.repeat(10_000) + '\r\n\r\n',
      String.fromCharCode(0, 1, 2, 3),
      '',
    ];
    for (const value of hostile) {
      assert.doesNotThrow(() => parseHttpResponseFields(value));
      assert.doesNotThrow(() => parseBanner(80, toBase64(value)));
    }
  });

  it('caps extracted header values at a bounded length', () => {
    const response = `HTTP/1.1 301 Moved\r\nLocation: http://x/${'a'.repeat(5000)}\r\n\r\n`;
    const parsed = parseHttpResponseFields(response);
    assert.ok(parsed.httpLocation!.length <= 300);
  });
});

describe('splitProductVersion', () => {
  it('splits a slash-delimited product/version pair', () => {
    assert.deepEqual(splitProductVersion('nginx/1.18.0'), ['nginx', '1.18.0']);
  });

  it('returns the whole string with a null version when there is no separator', () => {
    assert.deepEqual(splitProductVersion('nginx'), ['nginx', null]);
  });
});

/** A trivial in-memory BlobStore — no filesystem, no network, just enough to drive `parse()`. */
class FakeBlobStore implements BlobStore {
  private readonly store = new Map<string, Buffer>();

  async put(
    key: string,
    data: Buffer,
    _contentType: string,
  ): Promise<{ sha256: string; sizeBytes: number }> {
    this.store.set(key, data);
    return { sha256: 'fake', sizeBytes: data.byteLength };
  }
  async get(key: string): Promise<Buffer> {
    const value = this.store.get(key);
    if (!value) throw new Error(`no such key: ${key}`);
    return value;
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
  async exists(key: string): Promise<boolean> {
    return this.store.has(key);
  }
}

/**
 * End-to-end through `parse()`: proves the HTTP fields actually reach
 * `Observation.untrustedEvidence` under the keys the pipeline
 * (apps/worker/src/pipeline/process-scan-run.ts) reads by name, and that
 * `httpHeadersComplete` lands in `extractedAttributes` rather than
 * `untrustedEvidence` — it is a fact the adapter computed, not
 * attacker-supplied text (SEC-17).
 */
describe('TcpConnectDiscoveryAdapter.parse — wiring into Observation', () => {
  it('carries httpStatusLine/httpLocation/httpWwwAuthenticate as untrusted evidence, and httpHeadersComplete as an extracted attribute', async () => {
    const blobStore = new FakeBlobStore();
    const adapter = new TcpConnectDiscoveryAdapter(blobStore);

    const response = [
      'HTTP/1.1 401 Unauthorized',
      'Server: Apache/2.4.49',
      'WWW-Authenticate: Basic realm="Admin"',
      '',
      '',
    ].join('\r\n');

    const artifactBody = {
      hosts: [
        {
          address: '203.0.113.7',
          up: true,
          ports: [
            {
              port: 80,
              outcome: 'open',
              bannerBase64: Buffer.from(response, 'utf8').toString('base64'),
            },
          ],
        },
      ],
    };
    const blobKey = 'raw-artifacts/test/artifact.json';
    await blobStore.put(
      blobKey,
      Buffer.from(JSON.stringify(artifactBody), 'utf8'),
      'application/json',
    );

    const artifact: RawArtifact = {
      id: newId() as RawArtifact['id'],
      scanRunId: newId() as RawArtifact['scanRunId'],
      scannerAdapterKey: 'network-discovery',
      blobStoreKey: blobKey,
      contentType: 'application/json',
      sizeBytes: 0,
      sha256: 'fake',
      capturedAt: new Date().toISOString() as RawArtifact['capturedAt'],
    };

    const observations = await adapter.parse(artifact);
    assert.equal(observations.length, 1);
    const [observation] = observations;

    assert.equal(observation!.targetPort, 80);
    assert.equal(observation!.untrustedEvidence.product?.value, 'Apache');
    assert.equal(observation!.untrustedEvidence.httpStatusLine?.value, 'HTTP/1.1 401 Unauthorized');
    assert.equal(observation!.untrustedEvidence.httpWwwAuthenticate?.value, 'Basic realm="Admin"');
    assert.equal(observation!.untrustedEvidence.httpLocation, undefined);
    assert.equal(
      (observation!.extractedAttributes as Record<string, unknown>).httpHeadersComplete,
      true,
    );
  });

  it('omits the HTTP evidence keys entirely for a non-HTTP service', async () => {
    const blobStore = new FakeBlobStore();
    const adapter = new TcpConnectDiscoveryAdapter(blobStore);

    const artifactBody = {
      hosts: [
        {
          address: '203.0.113.8',
          up: true,
          ports: [
            {
              port: 22,
              outcome: 'open',
              bannerBase64: Buffer.from('SSH-2.0-OpenSSH_8.9p1\r\n', 'utf8').toString('base64'),
            },
          ],
        },
      ],
    };
    const blobKey = 'raw-artifacts/test/artifact-ssh.json';
    await blobStore.put(
      blobKey,
      Buffer.from(JSON.stringify(artifactBody), 'utf8'),
      'application/json',
    );

    const artifact: RawArtifact = {
      id: newId() as RawArtifact['id'],
      scanRunId: newId() as RawArtifact['scanRunId'],
      scannerAdapterKey: 'network-discovery',
      blobStoreKey: blobKey,
      contentType: 'application/json',
      sizeBytes: 0,
      sha256: 'fake',
      capturedAt: new Date().toISOString() as RawArtifact['capturedAt'],
    };

    const [observation] = await adapter.parse(artifact);
    assert.equal(observation!.untrustedEvidence.httpStatusLine, undefined);
    assert.equal(observation!.untrustedEvidence.httpLocation, undefined);
    assert.equal(observation!.untrustedEvidence.httpWwwAuthenticate, undefined);
    assert.equal(
      (observation!.extractedAttributes as Record<string, unknown>).httpHeadersComplete,
      false,
    );
  });
});
