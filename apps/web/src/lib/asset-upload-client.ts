'use client';

/**
 * Browser-side image upload into the media asset library via the existing
 * preflight → S3 PUT → confirm flow. Duplicate content (same sha256) resolves
 * to the already-stored asset without re-uploading.
 */

export type UploadedImageAsset = {
  assetId: string;
  /** Session-authenticated serving URL (works in <img> for the owner). */
  url: string;
  fileName: string;
  duplicate: boolean;
};

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function uploadImageAsset(
  file: File
): Promise<UploadedImageAsset> {
  if (!file.type.startsWith('image/')) {
    throw new Error(`${file.name} is not an image.`);
  }

  const buffer = await file.arrayBuffer();
  const sha256 = await sha256Hex(buffer);

  const preflightRes = await fetch('/api/a-plus/assets/preflight', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      sha256,
    }),
  });
  if (!preflightRes.ok) {
    const body = (await preflightRes.json().catch(() => null)) as {
      message?: string;
      error?: string;
    } | null;
    throw new Error(
      body?.message ||
        body?.error ||
        `Upload preflight failed for ${file.name}.`
    );
  }

  const preflight = (await preflightRes.json()) as {
    duplicate: boolean;
    asset: { assetId: string; originalFileName: string };
    upload?: { method: string; url: string; headers: Record<string, string> };
  };

  if (!preflight.duplicate && preflight.upload) {
    const putRes = await fetch(preflight.upload.url, {
      method: 'PUT',
      headers: preflight.upload.headers,
      body: buffer,
    });
    if (!putRes.ok) {
      throw new Error(`Storage upload failed for ${file.name}.`);
    }

    const confirmRes = await fetch('/api/a-plus/assets/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assetId: preflight.asset.assetId }),
    });
    if (!confirmRes.ok) {
      throw new Error(`Upload confirmation failed for ${file.name}.`);
    }
  }

  return {
    assetId: preflight.asset.assetId,
    url: `/api/a-plus/assets/${preflight.asset.assetId}`,
    fileName: preflight.asset.originalFileName || file.name,
    duplicate: preflight.duplicate,
  };
}
