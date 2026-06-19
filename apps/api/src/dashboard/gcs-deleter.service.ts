import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.service.js';

/**
 * GCS object-delete abstraction used by the purge job (contract section 3.10):
 * permanent deletion removes a session's GCS artifacts before its metadata rows.
 *
 * Kept local to the dashboard module so the foundation-owned StorageModule is
 * not modified. Two drivers mirror the reader/signer pattern:
 *   - 'gcs'   : @google-cloud/storage delete (loaded dynamically).
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
    this.base = config.STORAGE_EMULATOR_HOST ?? config.LOCAL_UPLOAD_BASE_URL;
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
export class CloudGcsDeleter implements GcsDeleter {
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

  async delete(gcsPath: string): Promise<void> {
    const storage = await this.getStorage();
    const file = storage.bucket(this.bucket).file(gcsPath);
    try {
      await file.delete({ ignoreNotFound: true });
    } catch (err: any) {
      if (err?.code === 404) return;
      throw err;
    }
  }
}
