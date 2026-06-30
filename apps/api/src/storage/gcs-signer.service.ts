import { Inject, Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import type { ArtifactType } from '@qassistant/shared/enums';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/config.service.js';

/**
 * GCS upload-credential abstraction (contract section 7). Mints per-object V4
 * signed URLs that are PUT-only, short-lived (~15 min), and scoped to a single
 * object path under the session prefix. The client can PUT one object; it cannot
 * read, list, or delete (the URL signs exactly one method + one resource).
 *
 * Two drivers behind one interface:
 *   - 'gcs'   : @google-cloud/storage getSignedUrl (V4, action 'write').
 *   - 'local' : a deterministic fake signed URL (HMAC over the same fields) that
 *               works offline against a fake-gcs/local sink. Never used in prod.
 */
export interface SignedUploadUrl {
  /** The full object path within the bucket (the GCS key). */
  gcsPath: string;
  /** The signed PUT URL the client uploads to. */
  uploadUrl: string;
  /** Headers the client MUST echo on the PUT (notably Content-Type). */
  requiredHeaders: Record<string, string>;
  /** ISO-8601 expiry. */
  expiresAt: string;
}

export interface SignUploadParams {
  gcsPath: string;
  contentType: string;
}

export interface GcsSigner {
  /** Mint a write-only signed URL for exactly the given object path. */
  signUpload(params: SignUploadParams): Promise<SignedUploadUrl>;
}

export const GCS_SIGNER = Symbol('GCS_SIGNER');

/**
 * Build the canonical object path for an artifact under the session prefix
 * (contract section 7):
 *   <tenantId>/<projectId>/<sessionId>/<type-dir>/<seq>.<ext>
 *   dom_chunk   -> dom/<seq>.json.gz
 *   screenshot  -> shots/<seq>.webp
 *   network_log -> net/<seq>.json.gz
 */
export function artifactObjectPath(params: {
  tenantId: string;
  projectId: string;
  sessionId: string;
  type: ArtifactType;
  seq: number;
}): string {
  const { tenantId, projectId, sessionId, type, seq } = params;
  const leaf =
    type === 'dom_chunk'
      ? `dom/${seq}.json.gz`
      : type === 'network_log'
        ? `net/${seq}.json.gz`
        : `shots/${seq}.webp`;
  return `${tenantId}/${projectId}/${sessionId}/${leaf}`;
}

/** Default content type for an artifact type when the client omits one. */
export function defaultContentType(type: ArtifactType): string {
  return type === 'screenshot' ? 'image/webp' : 'application/json';
}

@Injectable()
export class LocalGcsSigner implements GcsSigner {
  private readonly bucket: string;
  private readonly ttl: number;
  private readonly base: string;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.bucket = config.ARTIFACTS_BUCKET;
    this.ttl = config.UPLOAD_URL_TTL_SECONDS;
    this.base = config.STORAGE_EMULATOR_HOST ?? config.LOCAL_UPLOAD_BASE_URL;
  }

  async signUpload(params: SignUploadParams): Promise<SignedUploadUrl> {
    const expiresAtMs = Date.now() + this.ttl * 1000;
    const expiresAt = new Date(expiresAtMs).toISOString();
    // A fake but structurally-faithful signature: method+path+expiry, HMAC'd
    // with the internal token. Mirrors V4's "URL grants exactly one PUT".
    const toSign = `PUT\n${this.bucket}/${params.gcsPath}\n${expiresAtMs}`;
    const sig = createHmac('sha256', this.config.INTERNAL_TASK_TOKEN)
      .update(toSign)
      .digest('hex');
    const url = new URL(`${this.base.replace(/\/$/, '')}/${this.bucket}/${params.gcsPath}`);
    url.searchParams.set('X-Goog-Algorithm', 'LOCAL-HMAC-SHA256');
    url.searchParams.set('X-Goog-Expires', String(this.ttl));
    url.searchParams.set('X-Goog-SignedHeaders', 'content-type');
    url.searchParams.set('X-Goog-Signature', sig);
    return {
      gcsPath: params.gcsPath,
      uploadUrl: url.toString(),
      requiredHeaders: { 'Content-Type': params.contentType },
      expiresAt,
    };
  }
}

@Injectable()
export class CloudGcsSigner implements GcsSigner {
  private readonly bucket: string;
  private readonly ttl: number;
  private storage: any;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.bucket = config.ARTIFACTS_BUCKET;
    this.ttl = config.UPLOAD_URL_TTL_SECONDS;
  }

  private async getStorage(): Promise<any> {
    if (this.storage) return this.storage;
    const mod: any = await import('@google-cloud/storage' as string);
    this.storage = new mod.Storage();
    return this.storage;
  }

  async signUpload(params: SignUploadParams): Promise<SignedUploadUrl> {
    const storage = await this.getStorage();
    const expiresAtMs = Date.now() + this.ttl * 1000;
    const file = storage.bucket(this.bucket).file(params.gcsPath);
    // V4 write (PUT) URL for exactly this object. No read/list/delete granted.
    const [uploadUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: expiresAtMs,
      contentType: params.contentType,
    });
    return {
      gcsPath: params.gcsPath,
      uploadUrl,
      requiredHeaders: { 'Content-Type': params.contentType },
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  }
}
