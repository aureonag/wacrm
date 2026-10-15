import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import * as fs from "node:fs/promises";
import path from "node:path";

const MANIFEST = "manifest.json";
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
const MAX_ASSET_BYTES = 64 * 1024 * 1024;
const MAX_PACKAGE_BYTES = 8 * 1024 * 1024 * 1024;
const MAX_FILES = 100_000;
const DEFAULT_CACHE_BYTES = 32 * 1024 * 1024;
const MIME: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export class OfficeAssetError extends Error {
  readonly code: "OFFICE_ASSET_NOT_FOUND" | "OFFICE_ASSETS_UNAVAILABLE";

  constructor(readonly status: 404 | 503) {
    super(status === 404 ? "Office asset not found" : "Office runtime is unavailable");
    this.name = "OfficeAssetError";
    this.code = status === 404 ? "OFFICE_ASSET_NOT_FOUND" : "OFFICE_ASSETS_UNAVAILABLE";
  }
}

export interface LoadedOfficeAsset {
  bytes: Buffer;
  contentType: string;
  size: number;
  etag: string;
}

export interface OfficeAssetLoader {
  /** Raw relative URL path. The HTTP boundary must not decode percent escapes first. */
  load(relativePath: string): Promise<LoadedOfficeAsset>;
}

interface FileRecord { path: string; bytes: number; sha256: string; contentType: string }
interface InspectedFile { absolute: string; stamp: string; size: number }
interface ManifestCache { stamp: string; files: Map<string, FileRecord> }
interface CachedAsset { stamp: string; manifestStamp: string; bytes: Buffer }

function unavailable(): never { throw new OfficeAssetError(503); }
function notFound(): never { throw new OfficeAssetError(404); }
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);

function safeName(value: unknown): string {
  if (
    typeof value !== "string" || !value || value.length > 1024 ||
    !/^[a-zA-Z0-9_./-]+$/.test(value) || value.startsWith("/") ||
    value.split("/").some(segment => !segment || segment.length > 255 ||
      segment.startsWith(".") || segment.endsWith(".") ||
      /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(segment)) ||
    value.toLowerCase() === MANIFEST
  ) notFound();
  return value;
}

function stamp(info: Stats): string {
  return [info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs, info.birthtimeMs].join(":");
}

function inside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

/** No auth, env/default directory, route, source-folder fallback or ready-to-serve switch. */
export function createOfficeAssetLoader({ directory, maxCacheBytes = DEFAULT_CACHE_BYTES, requireCrmBootstrap = false }: {
  directory: string;
  maxCacheBytes?: number;
  requireCrmBootstrap?: boolean;
}): OfficeAssetLoader {
  if (typeof directory !== "string" || !directory.trim() ||
    !Number.isSafeInteger(maxCacheBytes) || maxCacheBytes < 0 || maxCacheBytes > MAX_ASSET_BYTES) unavailable();
  const root = path.resolve(directory);
  let manifestCache: ManifestCache | undefined;
  let pendingManifest: { stamp: string; promise: Promise<ManifestCache> } | undefined;
  const byteCache = new Map<string, CachedAsset>();
  let cachedBytes = 0;

  async function inspect(relative: string): Promise<InspectedFile> {
    const absolute = path.resolve(root, ...relative.split("/"));
    if (!inside(root, absolute)) unavailable();
    // Include configured root and its ancestors: Windows junctions are symlinks to lstat.
    const parsed = path.parse(absolute);
    let current = parsed.root;
    const segments = absolute.slice(parsed.root.length).split(path.sep).filter(Boolean);
    let final: Stats | undefined;
    for (let i = 0; i < segments.length; i++) {
      current = path.join(current, segments[i]);
      const info = await fs.lstat(current);
      if (info.isSymbolicLink() || (i < segments.length - 1 ? !info.isDirectory() : !info.isFile())) unavailable();
      final = info;
    }
    if (!final) unavailable();
    const [realRoot, realFile] = await Promise.all([fs.realpath(root), fs.realpath(absolute)]);
    if (!inside(realRoot, realFile)) unavailable();
    return { absolute, size: final.size, stamp: stamp(final) };
  }

  async function readChecked(relative: string, initial: InspectedFile, limit: number): Promise<Buffer> {
    if (!Number.isSafeInteger(initial.size) || initial.size < 0 || initial.size > limit) unavailable();
    const handle = await fs.open(initial.absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const before = await handle.stat();
      if (!before.isFile() || stamp(before) !== initial.stamp) unavailable();
      // Bound the read even if a file grows after stat. Never read a whole tree/file
      // of attacker-controlled size before detecting the package mismatch.
      const buffer = Buffer.allocUnsafe(initial.size + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
        if (bytesRead === 0) break;
        length += bytesRead;
      }
      const bytes = buffer.subarray(0, length);
      const after = await handle.stat();
      const current = await inspect(relative);
      if (bytes.length !== initial.size || stamp(after) !== initial.stamp || current.stamp !== initial.stamp) unavailable();
      return bytes;
    } finally {
      await handle.close();
    }
  }

  function parseManifest(bytes: Buffer, manifestStamp: string): ManifestCache {
    const data: unknown = JSON.parse(bytes.toString("utf8"));
    if (!isObject(data) || data.version !== 1 || data.mode !== "written" ||
      (requireCrmBootstrap && (data.crmBootstrapVersion !== 1 || data.crmSessionRequired !== true)) ||
      !Array.isArray(data.files) || data.files.length === 0 || data.files.length > MAX_FILES ||
      (data.fileCount !== undefined && data.fileCount !== data.files.length)) unavailable();
    const files = new Map<string, FileRecord>(), folded = new Set<string>();
    let total = 0;
    for (const item of data.files) {
      if (!isObject(item)) unavailable();
      let name: string;
      try { name = safeName(item.path); } catch { unavailable(); }
      const contentType = MIME[path.posix.extname(name).toLowerCase()];
      if (!contentType || typeof item.bytes !== "number" || !Number.isSafeInteger(item.bytes) ||
        item.bytes < 0 || item.bytes > MAX_ASSET_BYTES || typeof item.sha256 !== "string" ||
        !/^[0-9a-f]{64}$/i.test(item.sha256) || folded.has(name.toLowerCase())) unavailable();
      total += item.bytes;
      if (total > MAX_PACKAGE_BYTES) unavailable();
      folded.add(name.toLowerCase());
      files.set(name, { path: name, bytes: item.bytes, sha256: item.sha256.toLowerCase(), contentType });
    }
    return { stamp: manifestStamp, files };
  }

  async function manifest(): Promise<ManifestCache> {
    const info = await inspect(MANIFEST);
    if (manifestCache?.stamp === info.stamp) return manifestCache;
    if (pendingManifest?.stamp === info.stamp) return pendingManifest.promise;
    const promise = (async () => parseManifest(await readChecked(MANIFEST, info, MAX_MANIFEST_BYTES), info.stamp))();
    pendingManifest = { stamp: info.stamp, promise };
    try {
      const parsed = await promise;
      if (pendingManifest?.promise === promise) {
        manifestCache = parsed;
        byteCache.clear();
        cachedBytes = 0;
      }
      return parsed;
    } finally {
      if (pendingManifest?.promise === promise) pendingManifest = undefined;
    }
  }

  async function unchangedManifest(expected: string) {
    if ((await inspect(MANIFEST)).stamp !== expected) unavailable();
  }

  function cache(name: string, asset: CachedAsset) {
    const prior = byteCache.get(name);
    if (prior) { cachedBytes -= prior.bytes.length; byteCache.delete(name); }
    if (asset.bytes.length > maxCacheBytes) return;
    while (byteCache.size && cachedBytes + asset.bytes.length > maxCacheBytes) {
      const oldest = byteCache.keys().next().value!;
      cachedBytes -= byteCache.get(oldest)!.bytes.length;
      byteCache.delete(oldest);
    }
    byteCache.set(name, asset);
    cachedBytes += asset.bytes.length;
  }

  return {
    async load(relativePath) {
      const name = safeName(relativePath);
      try {
        const catalog = await manifest();
        const record = catalog.files.get(name);
        if (!record) notFound();
        const info = await inspect(name);
        if (info.size !== record.bytes) unavailable();
        const cached = byteCache.get(name);
        let bytes: Buffer;
        if (cached?.stamp === info.stamp && cached.manifestStamp === catalog.stamp) {
          // Return owned bytes, never the mutable cache backing buffer.
          bytes = Buffer.from(cached.bytes);
          byteCache.delete(name);
          byteCache.set(name, cached);
        } else {
          bytes = await readChecked(name, info, MAX_ASSET_BYTES);
          if (digest(bytes) !== record.sha256) unavailable();
        }
        await unchangedManifest(catalog.stamp);
        if (!cached || cached.stamp !== info.stamp || cached.manifestStamp !== catalog.stamp) {
          cache(name, { stamp: info.stamp, manifestStamp: catalog.stamp, bytes: Buffer.from(bytes) });
        }
        return { bytes, contentType: record.contentType, size: bytes.length, etag: `"${record.sha256}"` };
      } catch (error) {
        if (error instanceof OfficeAssetError) throw error;
        throw new OfficeAssetError(503);
      }
    },
  };
}
