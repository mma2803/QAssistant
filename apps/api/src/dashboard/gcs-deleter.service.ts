import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.service.js';

/**
 * GCS object-delete abstraction used by the purge job (contract section 3.10):
 * permanent deletion removes a session's GCS artifacts before its metadata rows.
 *
 * Kept local to the dashboard module so the foundation-owned StorageModule is
 * not modified. Two drivers mirror the reader/signer pattern:
 *   - 's3'    : S3-compatible DeleteObjectCommand (@aws-sdk/client-s3), pointed
 *               at MinIO in prod (self-hosted VPS migration; replaces GCS).
 *   - 'local' : best-effort HTTP DELETE against the local sink; missing objects
 *               and an unreachable sink are treated as success (idempotent purge).
 */
export interface GcsDeleter {
  /** Delete one object. Resolves even if the object is already absent. */
  delete(gcsPath: string): Promise<void>;
}

export const GCS_DELETER = Symbol('GCS_DELETER');

@Injectable()
export class LocalGcsDeleter implements GcsDeleter {
  private readonly bucket: string;
  private readonly base: string;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.bucket = config.ARTIFACTS_BUCKET;
    this.base = config.LOCAL_UPLOAD_BASE_URL;
  }

  async delete(gcsPath: string): Promise<void> {
    const url = `${this.base.replace(/\/$/, '')}/${this.bucket}/${gcsPath}`;
    try {
      await fetch(url, { method: 'DELETE' });
    } catch {
      // No local sink reachable in offline/unit runs: purge is idempotent, so a
      // failed delete of an object that may not exist is not fatal.
    }
  }
}

@Injectable()
export class S3GcsDeleter implements GcsDeleter {
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

  async delete(gcsPath: string): Promise<void> {
    const mod: any = await import('@aws-sdk/client-s3' as string);
    const client = await this.getClient();
    try {
      // S3 delete is already idempotent/no-error-on-missing-key, unlike GCS.
      await client.send(new mod.DeleteObjectCommand({ Bucket: this.bucket, Key: gcsPath }));
    } catch (err: any) {
      if (err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) return;
      throw err;
    }
  }
}
