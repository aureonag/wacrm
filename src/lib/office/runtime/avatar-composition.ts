const VERSION = "20260929T190313Z";
const MAX_BYTES = 1024 * 1024;
const MAX_CACHE_BYTES = 32 * MAX_BYTES;
const MAX_PENDING = 8;
const TIMEOUT_MS = 12_000;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const WEARABLE_ID = /^[0-9a-f-]{1,36}$/;

export class OfficeAvatarError extends Error {
  readonly code: "OFFICE_AVATAR_INVALID" | "OFFICE_AVATAR_BUSY" | "OFFICE_AVATAR_UPSTREAM" | "OFFICE_AVATAR_UNAVAILABLE";

  constructor(readonly status: 400 | 429 | 502 | 503) {
    const messages = {
      400: "Invalid office avatar combination",
      429: "Office avatar previews are busy",
      502: "Office avatar preview could not be loaded",
      503: "Office avatar library is unavailable",
    };
    super(messages[status]);
    this.name = "OfficeAvatarError";
    this.code = ({ 400: "OFFICE_AVATAR_INVALID", 429: "OFFICE_AVATAR_BUSY", 502: "OFFICE_AVATAR_UPSTREAM", 503: "OFFICE_AVATAR_UNAVAILABLE" } as const)[status];
  }
}

export interface OfficeAvatarComposer {
  load(kind: unknown, recipe: unknown): Promise<{ bytes: Buffer }>;
}

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function knownWearables(library: unknown): Map<string, string> {
  function fail(): never { throw new OfficeAvatarError(503); }
  if (!object(library) || !Array.isArray(library.categories) ||
    library.categories.length === 0 || library.categories.length > 64) fail();
  const known = new Map<string, string>(), categories = new Set<string>();
  let variants = 0, items = 0;
  for (const category of library.categories) {
    if (!object(category) || typeof category.id !== "string" || !category.id ||
      category.id.length > 100 || categories.has(category.id) || !Array.isArray(category.items)) fail();
    categories.add(category.id);
    items += category.items.length;
    if (items > 100_000) fail();
    for (const item of category.items) {
      if (!object(item) || !Array.isArray(item.variants)) fail();
      variants += item.variants.length;
      if (variants > 100_000) fail();
      for (const variant of item.variants) {
        if (!object(variant) || typeof variant.wearableId !== "string" ||
          !WEARABLE_ID.test(variant.wearableId)) fail();
        const previous = known.get(variant.wearableId);
        if (previous !== undefined && previous !== category.id) fail();
        known.set(variant.wearableId, category.id);
      }
    }
  }
  if (known.size === 0) fail();
  return known;
}

function validatePng(bytes: Buffer, kind: "essentials" | "extras") {
  if (bytes.length < 33 || bytes.length > MAX_BYTES ||
    !bytes.subarray(0, 8).equals(PNG_SIGNATURE) || bytes.readUInt32BE(8) !== 13 ||
    bytes.toString("ascii", 12, 16) !== "IHDR" ||
    bytes.readUInt32BE(16) !== (kind === "essentials" ? 2304 : 896) ||
    bytes.readUInt32BE(20) !== (kind === "essentials" ? 64 : 320)) {
    throw new OfficeAvatarError(502);
  }
}

/** Library and fetch are injected; this module has no file cache, auth or input URL. */
export function createOfficeAvatarComposer({ loadLibrary, fetchImpl = fetch }: {
  loadLibrary: () => Promise<unknown>;
  fetchImpl?: typeof fetch;
}): OfficeAvatarComposer {
  const pending = new Map<string, Promise<Buffer>>();
  const cache = new Map<string, Buffer>();
  let cacheBytes = 0;
  let libraryPromise: Promise<Map<string, string>> | undefined;

  function library(): Promise<Map<string, string>> {
    if (!libraryPromise) {
      libraryPromise = Promise.resolve().then(loadLibrary).then(knownWearables).catch(() => {
        libraryPromise = undefined;
        throw new OfficeAvatarError(503);
      });
    }
    return libraryPromise;
  }

  function remember(key: string, bytes: Buffer) {
    while (cacheBytes + bytes.length > MAX_CACHE_BYTES && cache.size) {
      const oldest = cache.keys().next().value!;
      cacheBytes -= cache.get(oldest)!.length;
      cache.delete(oldest);
    }
    cache.set(key, bytes);
    cacheBytes += bytes.length;
  }

  async function retrieve(kind: "essentials" | "extras", recipe: string): Promise<Buffer> {
    const url = `https://sprite.v2.gather.town/v2/sprite/${kind === "extras" ? "avatar_extras-" : "avatar-"}${recipe}.${VERSION}.png`;
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        void reader?.cancel().catch(() => {});
        reject(new OfficeAvatarError(502));
      }, TIMEOUT_MS);
    });
    const operation = (async () => {
      const response = await fetchImpl(url, {
        signal: controller.signal, redirect: "error", headers: { Accept: "image/png" },
      });
      try {
        if (controller.signal.aborted || !response.ok || response.status < 200 || response.status >= 300 ||
          response.redirected || (response.url && response.url !== url)) throw new OfficeAvatarError(502);
        const declared = response.headers.get("content-length");
        if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_BYTES)) throw new OfficeAvatarError(502);
        if (!response.body) throw new OfficeAvatarError(502);
        reader = response.body.getReader();
        const chunks: Buffer[] = [];
        let size = 0, reads = 0;
        for (;;) {
          if (controller.signal.aborted || ++reads > 4096) throw new OfficeAvatarError(502);
          const chunk = await reader.read();
          if (controller.signal.aborted) throw new OfficeAvatarError(502);
          if (chunk.done) break;
          if (!(chunk.value instanceof Uint8Array)) throw new OfficeAvatarError(502);
          size += chunk.value.byteLength;
          if (size > MAX_BYTES) throw new OfficeAvatarError(502);
          chunks.push(Buffer.from(chunk.value));
        }
        const bytes = Buffer.concat(chunks, size);
        validatePng(bytes, kind);
        return bytes;
      } finally {
        if (reader) {
          void reader.cancel().catch(() => {});
          try { reader.releaseLock(); } catch { /* A timed-out read may still be settling. */ }
        } else {
          void response.body?.cancel().catch(() => {});
        }
      }
    })();
    try {
      return await Promise.race([operation, timeout]);
    } catch {
      controller.abort();
      void reader?.cancel().catch(() => {});
      throw new OfficeAvatarError(502);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  return {
    async load(kind, recipe) {
      if ((kind !== "essentials" && kind !== "extras") || typeof recipe !== "string" ||
        !recipe || recipe.length > 406 || !/^[0-9a-f-]+(?:\.[0-9a-f-]+)*$/.test(recipe)) {
        throw new OfficeAvatarError(400);
      }
      const ids = recipe.split(".");
      if (ids.length > 11 || ids.some(id => !WEARABLE_ID.test(id))) throw new OfficeAvatarError(400);
      const known = await library();
      if (ids.some(id => !known.has(id)) || new Set(ids.map(id => known.get(id))).size !== ids.length) {
        throw new OfficeAvatarError(400);
      }
      const key = `${kind}:${recipe}`;
      const cached = cache.get(key);
      if (cached) {
        cache.delete(key);
        cache.set(key, cached);
        return { bytes: Buffer.from(cached) };
      }
      let task = pending.get(key);
      if (!task) {
        if (pending.size >= MAX_PENDING) throw new OfficeAvatarError(429);
        task = retrieve(kind, recipe).then(bytes => { remember(key, bytes); return bytes; });
        pending.set(key, task);
        const finished = () => { if (pending.get(key) === task) pending.delete(key); };
        void task.then(finished, finished);
      }
      return { bytes: Buffer.from(await task) };
    },
  };
}
