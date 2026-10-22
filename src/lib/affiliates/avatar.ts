// Photo of a store person (portal da loja): what we accept and where it lives.
// Pure helpers, shared by the upload route and its tests.

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const AVATAR_BUCKET = "avatars";

export interface DetectedImage {
  mime: "image/png" | "image/jpeg" | "image/webp";
  ext: "png" | "jpg" | "webp";
}

/** Looks at the first bytes (not at the name or the declared type) — only real PNG/JPEG/WebP pass. */
export function detectImageType(bytes: Uint8Array): DetectedImage | null {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { mime: "image/png", ext: "png" };
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // RIFF
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 // WEBP
  ) {
    return { mime: "image/webp", ext: "webp" };
  }
  return null;
}

/** Storage path of a person's new photo. */
export function avatarPath(clientId: string, userRowId: string, ext: string, now = Date.now()): string {
  return `aff-store/${clientId}/${userRowId}-${now}.${ext}`;
}

/**
 * The storage path behind a public URL of ours, or null when the URL is not one of
 * this store's photos (so a tampered value can never make us delete someone else's file).
 */
export function avatarPathFromUrl(url: string | null | undefined, clientId: string): string | null {
  if (!url) return null;
  const marker = `/${AVATAR_BUCKET}/`;
  const at = url.indexOf(marker);
  if (at < 0) return null;
  const path = decodeURIComponent(url.slice(at + marker.length).split("?")[0]);
  return path.startsWith(`aff-store/${clientId}/`) && !path.includes("..") ? path : null;
}
