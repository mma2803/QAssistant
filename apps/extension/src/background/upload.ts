import type { UploadUrlsResponse } from '@qassistant/shared';
import { getUploadUrls, registerArtifact } from './api.js';

/**
 * Artifact chunking and upload (task 3.5/3.6 plumbing). Flow per artifact:
 *   1. ask the backend for a write-only V4 signed PUT URL (GET /upload-urls),
 *   2. PUT the bytes straight to GCS (the client never reads/lists/deletes),
 *   3. register the metadata via POST /artifacts so the row is tenant-stamped.
 * The signed URL is scoped to the session's own object path; identity and the
 * gcsPath layout are decided server-side (contract section 7).
 */

/** gzip a UTF-8 string using the platform CompressionStream (available in MV3 SW). */
export async function gzipString(text: string): Promise<Blob> {
  const input = new Blob([text]);
  const stream = input.stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).blob();
}

/** crc32c is not in the platform; use a simple hex md5-free length+sha is overkill, omit. */

export interface UploadDomChunkArgs {
  sessionId: string;
  seq: number;
  /** Serialized rrweb events JSON for this chunk. */
  json: string;
  capturedAtIso: string;
}

export async function uploadDomChunk(args: UploadDomChunkArgs): Promise<void> {
  const gz = await gzipString(args.json);
  const urls = await getUploadUrls(args.sessionId, [{ type: 'dom_chunk', seq: args.seq }]);
  const slot = pickSlot(urls, 'dom_chunk', args.seq);
  await putToGcs(slot.uploadUrl, gz, {
    ...slot.requiredHeaders,
    'content-type': slot.requiredHeaders['content-type'] ?? 'application/gzip',
  });
  await registerArtifact(args.sessionId, {
    type: 'dom_chunk',
    seq: args.seq,
    gcsPath: slot.gcsPath,
    contentType: 'application/json',
    sizeBytes: gz.size,
    compression: 'gzip',
    capturedAt: args.capturedAtIso,
  });
}

export interface UploadScreenshotArgs {
  sessionId: string;
  seq: number;
  /** Image blob (webp/png) captured from the visible tab. */
  blob: Blob;
  capturedAtIso: string;
}

export async function uploadScreenshot(args: UploadScreenshotArgs): Promise<void> {
  const urls = await getUploadUrls(args.sessionId, [{ type: 'screenshot', seq: args.seq }]);
  const slot = pickSlot(urls, 'screenshot', args.seq);
  await putToGcs(slot.uploadUrl, args.blob, {
    ...slot.requiredHeaders,
    'content-type': slot.requiredHeaders['content-type'] ?? args.blob.type ?? 'image/webp',
  });
  await registerArtifact(args.sessionId, {
    type: 'screenshot',
    seq: args.seq,
    gcsPath: slot.gcsPath,
    contentType: args.blob.type || 'image/webp',
    sizeBytes: args.blob.size,
    compression: 'none',
    capturedAt: args.capturedAtIso,
  });
}

function pickSlot(urls: UploadUrlsResponse, type: 'dom_chunk' | 'screenshot', seq: number) {
  const slot = urls.items.find((i) => i.type === type && i.seq === seq) ?? urls.items[0];
  if (!slot) {
    throw new Error('No upload URL returned for requested artifact slot');
  }
  return slot;
}

async function putToGcs(uploadUrl: string, body: Blob, headers: Record<string, string>): Promise<void> {
  const res = await fetch(uploadUrl, { method: 'PUT', headers, body });
  if (!res.ok) {
    throw new Error(`GCS upload failed (${res.status})`);
  }
}
