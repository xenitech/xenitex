import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, relative } from 'node:path';
import type { BlobStore } from '@xenitex/domain';

/**
 * EXT-08's filesystem implementation. Lives here (packages/db), not
 * apps/api/src as the interface's own comment originally suggested — that
 * assumed a single writer, but DATA-01 requires both apps/api (serves
 * `/raw-artifacts/{id}/download`) and apps/worker (writes artifacts during
 * scan execution, SEC-03) to reach the same durable storage from two
 * separate containers. Sharing one Docker volume mounted at the same path
 * in both, backed by one implementation both import from this common
 * package, is simpler than either an app-to-app import or an internal
 * HTTP hand-off for a single-VPS appliance (Part A.5) — see
 * deploy/compose/docker-compose.yml's `blobstore` volume.
 */
export class FilesystemBlobStore implements BlobStore {
  constructor(private readonly rootDir: string) {}

  private resolveKey(key: string): string {
    // SEC-12-adjacent: a key is never trusted to stay inside rootDir on its
    // own — reject anything that normalizes outside it (path traversal via
    // `../`) before it ever reaches a filesystem call.
    const resolved = normalize(join(this.rootDir, key));
    const rel = relative(this.rootDir, resolved);
    if (rel.startsWith('..') || rel === '') {
      throw new Error(`Blob key resolves outside the blob store root: ${key}`);
    }
    return resolved;
  }

  async put(
    key: string,
    data: Buffer,
    _contentType: string,
  ): Promise<{ sha256: string; sizeBytes: number }> {
    const path = this.resolveKey(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data, { mode: 0o600 });
    return { sha256: createHash('sha256').update(data).digest('hex'), sizeBytes: data.byteLength };
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.resolveKey(key));
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolveKey(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolveKey(key));
      return true;
    } catch {
      return false;
    }
  }
}
