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
 *   - 's3'    : S3-compatible GetObjectCommand (@aws-sdk/client-s3), pointed at
 *               MinIO in prod (self-hosted VPS migration; replaces GCS).
 *   - 'local' : reads from the same local sink the LocalGcsSigner writes to, by
 *               HTTP GET against LOCAL_UPLOAD_BASE_URL/<bucket>/<path>. If the
 *               object is absent (no live sink in tests) it returns null so the
 *               worker degrades gracefully rather than throwing.
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
    this.base = config.LOCAL_UPLOAD_BASE_URL;
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
export class S3GcsReader implements GcsReader {
  private readonly bucket: string;
  private client: any;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.bucket = config.ARTIFACTS_BUCKET;
  }

  private async getClient(): Promise<any> {
    if (this.client) return this.client;
    const mod: any = await import('@aws-sdk/client-s3' as string);
    this.client = new mod.S3Client({
      endpoint: this.config.S3_ENDPOINT,
      region: this.config.S3_REGION,
      forcePathStyle: this.config.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: this.config.S3_ACCESS_KEY_ID,
        secretAccessKey: this.config.S3_SECRET_ACCESS_KEY,
      },
    });
    return this.client;
  }

  async download(gcsPath: string): Promise<Buffer | null> {
    const mod: any = await import('@aws-sdk/client-s3' as string);
    const client = await this.getClient();
    try {
      const result = await client.send(
        new mod.GetObjectCommand({ Bucket: this.bucket, Key: gcsPath }),
      );
      const bytes = await result.Body.transformToByteArray();
      return Buffer.from(bytes);
    } catch (err: any) {
      if (err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) return null;
      throw err;
    }
  }
}
