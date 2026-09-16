/**
 * EXT-08. Filesystem implementation now; object-storage implementation stubbed
 * for later. The pipeline and reports (DATA-01, 4.8) depend only on this
 * interface, never on `fs` directly.
 */
export interface BlobStore {
  put(
    key: string,
    data: Buffer,
    contentType: string,
  ): Promise<{ readonly sha256: string; readonly sizeBytes: number }>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

/**
 * Real implementation is `FilesystemBlobStore` in packages/db (not
 * apps/api/src as originally planned here) — apps/api and apps/worker are
 * separate containers that both need to reach the same durable storage
 * (DATA-01), so the implementation lives in a package both import, backed
 * by one shared Docker volume, rather than in either app alone. This
 * package itself stays I/O-free.
 */
export class NotImplementedObjectStorageBlobStore implements BlobStore {
  put(): Promise<{ readonly sha256: string; readonly sizeBytes: number }> {
    throw new Error(
      'NotImplementedObjectStorageBlobStore: object-storage BlobStore is not implemented in this release.',
    );
  }
  get(): Promise<Buffer> {
    throw new Error(
      'NotImplementedObjectStorageBlobStore: object-storage BlobStore is not implemented in this release.',
    );
  }
  delete(): Promise<void> {
    throw new Error(
      'NotImplementedObjectStorageBlobStore: object-storage BlobStore is not implemented in this release.',
    );
  }
  exists(): Promise<boolean> {
    throw new Error(
      'NotImplementedObjectStorageBlobStore: object-storage BlobStore is not implemented in this release.',
    );
  }
}
