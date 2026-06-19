import { Inject, Injectable } from '@nestjs/common';
import { gunzipSync } from 'node:zlib';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.service.js';

/**
 * GCS object-read abstraction (the read side of contract section 7). The codegen
 * worker needs to pull a session's DOM-replay chunks (and, optionally, screenshot
 * bytes) back out of GCS to ground generation. Capture writes via signed PUT
 * URLs; this reads the same objects server-side.
 *
 * Two drivers behind one interface so the worker runs offline:
 *   - 'gcs'   : @google-cloud/storage download() (loaded dynamically so the
 *               package stays an optional runtime dep, matching CloudGcsSigner).
 *   - 'local' : reads from the same fake-gcs/local sink the LocalGcsSigner writes
 *               to, by HTTP GET against LOCAL_UPLOAD_BASE_URL/<bucket>/<path>.
 *               If the object is absent (no live sink in tests) it returns null
 *               so the worker degrades gracefully rather than throwing.
 */
export interface GcsReader {
  /** Download raw object bytes for a path, or null if it does not exist. */
  download(gcsPath: string): Promise<Buffer | null>;
}

export const GCS_READER = Symbol('GCS_READER');

/** Decode a possibly gzip-compressed buffer to a UTF-8 string. */
export function decodeArtifactText(bytes: Buffer, compression: 'none' | 'gzip'): string {
  const raw = compression === 'gzip' ? gunzipSync(bytes) : bytes;
  return raw.toString('utf8');
}

@Injectable()
export class LocalGcsReader implements GcsReader {
  private readonly bucket: string;
  private readonly base: string;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.bucket = config.ARTIFACTS_BUCKET;
    this.base = config.STORAGE_EMULATOR_HOST ?? config.LOCAL_UPLOAD_BASE_URL;
  }

  async download(gcsPath: string): Promise<Buffer | null> {
    const url = `${this.base.replace(/\/$/, '')}/${this.bucket}/${gcsPath}`;
    try {
      const res = await fetch(url, { method: 'GET' });
      if (res.status === 404) return null;
      if (!res.ok) return null;
      const arr = await res.arrayBuffer();
      return Buffer.from(arr);
    } catch {
      // No local sink reachable (common in unit/offline runs): degrade to null
      // so the worker still produces a grounded-as-possible generation.
      return null;
    }
  }
}

@Injectable()
export class CloudGcsReader implements GcsReader {
  private readonly bucket: string;
  private storage: any;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.bucket = config.ARTIFACTS_BUCKET;
  }

  private async getStorage(): Promise<any> {
    if (this.storage) return this.storage;
    const mod: any = await import('@google-cloud/storage' as string);
    this.storage = new mod.Storage();
    return this.storage;
  }

  async download(gcsPath: string): Promise<Buffer | null> {
    const storage = await this.getStorage();
    const file = storage.bucket(this.bucket).file(gcsPath);
    try {
      const [contents] = await file.download();
      return contents as Buffer;
    } catch (err: any) {
      if (err?.code === 404) return null;
      throw err;
    }
  }
}
