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
 *   - 's3'    : S3-compatible presigned PUT URL (@aws-sdk/client-s3 +
 *               @aws-sdk/s3-request-presigner), pointed at MinIO in prod via
 *               S3_ENDPOINT (self-hosted VPS migration; replaces GCS).
 *   - 'local' : a deterministic fake signed URL (HMAC over the same fields) that
 *               works offline against a local sink. Never used in prod.
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
    this.base = config.LOCAL_UPLOAD_BASE_URL;
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
export class S3GcsSigner implements GcsSigner {
  private readonly bucket: string;
  private readonly ttl: number;
  private client: any;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.bucket = config.ARTIFACTS_BUCKET;
    this.ttl = config.UPLOAD_URL_TTL_SECONDS;
  }

  private async getClient(): Promise<any> {
    if (this.client) return this.client;
    const mod: any = await import('@aws-sdk/client-s3' as string);
    // Presign against the PUBLIC endpoint so the signed host matches what the
    // browser will PUT to (and what MinIO validates behind Caddy). Presigning
    // is offline (no network call here), so this only shapes the URL host.
    // Falls back to the internal endpoint when no public one is configured.
    this.client = new mod.S3Client({
      endpoint: this.config.S3_PUBLIC_ENDPOINT ?? this.config.S3_ENDPOINT,
      region: this.config.S3_REGION,
      forcePathStyle: this.config.S3_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: this.config.S3_ACCESS_KEY_ID,
        secretAccessKey: this.config.S3_SECRET_ACCESS_KEY,
      },
    });
    return this.client;
  }

  async signUpload(params: SignUploadParams): Promise<SignedUploadUrl> {
    const [{ PutObjectCommand }, { getSignedUrl }, client] = await Promise.all([
      import('@aws-sdk/client-s3' as string),
      import('@aws-sdk/s3-request-presigner' as string),
      this.getClient(),
    ]);
    const expiresAtMs = Date.now() + this.ttl * 1000;
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: params.gcsPath,
      ContentType: params.contentType,
    });
    // Presigned PUT for exactly this object. No read/list/delete granted.
    const uploadUrl = await getSignedUrl(client, command, { expiresIn: this.ttl });
    return {
      gcsPath: params.gcsPath,
      uploadUrl,
      requiredHeaders: { 'Content-Type': params.contentType },
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  }
}
