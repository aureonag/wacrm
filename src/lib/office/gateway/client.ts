import { createHash } from "node:crypto";
import type { OfficeContext } from "../access";
import type { LoadedOfficeAsset } from "../runtime/assets";
import { normalizeOfficeCallConflict, officeCallConflictMessage, type OfficeCallConflictCode } from "../runtime/call-conflicts.cjs";
import {
  OFFICE_GATEWAY_LIMITS, OfficeGatewayContractError, parseRuntimeOperation, type RuntimeOperation,
} from "./contracts";
import { createOfficeGatewayProtocol, OfficeGatewayError, OFFICE_GATEWAY_PATHS } from "./protocol";

export class OfficeGatewayClientError extends Error {
  readonly code: "OFFICE_GATEWAY_INVALID_REQUEST" | "OFFICE_GATEWAY_OPERATION_FAILED" | "OFFICE_GATEWAY_UNAVAILABLE" | OfficeCallConflictCode;
  constructor(readonly status: number = 503, callCode?: unknown) {
    const conflict = normalizeOfficeCallConflict(status, callCode);
    super(officeCallConflictMessage(conflict) || (status === 503 ? "O escritório está temporariamente indisponível." :
      status === 409 ? "O escritório foi atualizado. Recarregue e tente novamente." :
      status === 403 ? "Esta operação do escritório não está disponível." :
      status === 413 ? "O conteúdo excede o tamanho permitido." : "Não foi possível concluir esta operação do escritório."));
    this.name = "OfficeGatewayClientError";
    this.code = conflict || (status === 503 ? "OFFICE_GATEWAY_UNAVAILABLE" : status === 400 || status === 413
      ? "OFFICE_GATEWAY_INVALID_REQUEST" : "OFFICE_GATEWAY_OPERATION_FAILED");
  }
}

export class OfficeGatewayBodyError extends Error {
  constructor(readonly kind: "limit" | "invalid" | "aborted") { super("Invalid office gateway body"); }
}

/** Bound actual streamed bytes; Content-Length alone is never trusted. */
export async function readOfficeGatewayBytes(
  source: Pick<Response, "body" | "headers">, maximum: number, signal?: AbortSignal,
): Promise<Buffer> {
  const length = source.headers.get("content-length");
  if (length !== null && (!/^[0-9]+$/.test(length) || !Number.isSafeInteger(Number(length)))) {
    await source.body?.cancel().catch(() => {});
    throw new OfficeGatewayBodyError("invalid");
  }
  if (length !== null && Number(length) > maximum) {
    await source.body?.cancel().catch(() => {});
    throw new OfficeGatewayBodyError("limit");
  }
  if (signal?.aborted) { await source.body?.cancel().catch(() => {}); throw new OfficeGatewayBodyError("aborted"); }
  const reader = source.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let abortHandler: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    if (signal) {
      abortHandler = () => {
        void reader.cancel().catch(() => {});
        reject(new OfficeGatewayBodyError("aborted"));
      };
      signal.addEventListener("abort", abortHandler, { once: true });
    }
  });
  try {
    while (true) {
      const chunk = await Promise.race([reader.read(), aborted]);
      if (signal?.aborted) throw new OfficeGatewayBodyError("aborted");
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maximum) { await reader.cancel().catch(() => {}); throw new OfficeGatewayBodyError("limit"); }
      chunks.push(Buffer.from(chunk.value));
    }
    return Buffer.concat(chunks, bytes);
  } finally {
    if (signal && abortHandler) signal.removeEventListener("abort", abortHandler);
    reader.releaseLock();
  }
}

export interface OfficeGatewayBootstrap {
  map: Record<string, unknown>;
  clientState: Record<string, string>;
}
export interface OfficeGatewayClient {
  bootstrap(identity: OfficeContext): Promise<OfficeGatewayBootstrap>;
  interface(identity: OfficeContext, method: string, endpoint: string, body?: Record<string, unknown>, query?: Record<string, unknown>): Promise<Record<string, unknown>>;
  asset(identity: OfficeContext, relativePath: string): Promise<LoadedOfficeAsset>;
  avatar(identity: OfficeContext, kind: unknown, recipe: unknown): Promise<{ bytes: Buffer }>;
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const MIME = [
  "text/html; charset=utf-8", "application/javascript; charset=utf-8", "text/css; charset=utf-8",
  "application/json; charset=utf-8", "image/svg+xml", "image/png", "image/jpeg", "image/webp",
  "image/gif", "image/x-icon", "audio/mpeg", "audio/ogg", "audio/wav", "font/woff", "font/woff2",
];
const canonicalMime = new Map(MIME.map(value => [value.replace(/\s/g, ""), value]));
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function targetUrl(value: string, allowInsecureLocalhostForTests: boolean): string {
  try {
    const url = new URL(value);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !(allowInsecureLocalhostForTests && local && url.protocol === "http:")) ||
      url.username || url.password || url.search || url.hash ||
      !["/", OFFICE_GATEWAY_PATHS.runtime].includes(url.pathname)) throw new Error("Invalid URL");
    url.pathname = OFFICE_GATEWAY_PATHS.runtime;
    return url.href;
  } catch { throw new OfficeGatewayClientError(); }
}
const jsonMime = (value: string | null) => !!value && /^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(value);
const publicStatuses = new Set([400, 403, 404, 405, 409, 413, 415, 422, 429]);

/** Pure transport: no env, cookie jar, browser token, retry, or Supabase client. */
export function createOfficeGatewayClient({
  url, key, fetch: fetcher = globalThis.fetch, allowInsecureLocalhostForTests = false,
}: {
  url: string; key: Uint8Array; fetch?: typeof fetch; allowInsecureLocalhostForTests?: boolean;
}): OfficeGatewayClient {
  const target = targetUrl(url, allowInsecureLocalhostForTests);
  let protocol: ReturnType<typeof createOfficeGatewayProtocol>;
  try { protocol = createOfficeGatewayProtocol({ key, audience: "runtime" }); } catch { throw new OfficeGatewayClientError(); }

  async function send(value: unknown): Promise<Record<string, unknown> | OfficeGatewayBootstrap | LoadedOfficeAsset | { bytes: Buffer }> {
    let operation: RuntimeOperation;
    try { operation = parseRuntimeOperation(value); }
    catch (error) { throw new OfficeGatewayClientError(error instanceof OfficeGatewayContractError ? error.status : 400); }
    let signed: ReturnType<typeof protocol.sign>;
    try { signed = protocol.sign(JSON.stringify(operation)); }
    catch (error) { throw new OfficeGatewayClientError(error instanceof OfficeGatewayError && error.status === 413 ? 413 : 503); }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new OfficeGatewayClientError()); }, OFFICE_GATEWAY_LIMITS.timeoutMs);
    });
    async function transfer() {
      const response = await fetcher(target, {
        method: "POST", credentials: "omit", redirect: "error", cache: "no-store", signal: controller.signal,
        headers: { ...signed.headers, "Content-Type": "application/json" }, body: new Uint8Array(signed.body),
      });
      if (response.redirected || response.url && response.url !== target) {
        await response.body?.cancel().catch(() => {}); throw new OfficeGatewayClientError();
      }
      if (!response.ok) {
        let callCode: OfficeCallConflictCode | undefined;
        // Signaling and a version-bound creation can identify a replaced call. Never
        // forward an upstream message, arbitrary code, or an unbounded error body.
        const signaling = operation.operation === "interface" &&
          (operation.method === "GET" && operation.endpoint === "signals" ||
           operation.method === "POST" && (operation.endpoint === "signal" || operation.endpoint === "call-session"));
        if (response.status === 409 && signaling && jsonMime(response.headers.get("content-type"))) {
          try {
            const bytes = await readOfficeGatewayBytes(response, 4096, controller.signal);
            const result: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
            if (object(result) && Object.hasOwn(result, "code")) callCode = normalizeOfficeCallConflict(response.status, result.code);
          } catch {
            if (controller.signal.aborted) throw new OfficeGatewayClientError();
          }
        } else await response.body?.cancel().catch(() => {});
        throw new OfficeGatewayClientError(publicStatuses.has(response.status) ? response.status : 503, callCode);
      }
      const limit = operation.operation === "asset" ? OFFICE_GATEWAY_LIMITS.assetResponseBytes :
        operation.operation === "avatar" ? OFFICE_GATEWAY_LIMITS.avatarResponseBytes : OFFICE_GATEWAY_LIMITS.runtimeJsonResponseBytes;
      const bytes = await readOfficeGatewayBytes(response, limit, controller.signal);
      if (operation.operation === "asset") {
        const contentType = canonicalMime.get((response.headers.get("content-type") || "").toLowerCase().replace(/\s/g, ""));
        const digest = '"' + createHash("sha256").update(bytes).digest("hex") + '"';
        const etag = response.headers.get("etag");
        if (!contentType || etag !== null && etag !== digest) throw new OfficeGatewayClientError();
        return { bytes, contentType, size: bytes.length, etag: digest };
      }
      if (operation.operation === "avatar") {
        if (response.headers.get("content-type")?.toLowerCase() !== "image/png" || bytes.length < 8 || !bytes.subarray(0, 8).equals(PNG)) {
          throw new OfficeGatewayClientError();
        }
        return { bytes };
      }
      if (!jsonMime(response.headers.get("content-type"))) throw new OfficeGatewayClientError();
      const result: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      if (!object(result)) throw new OfficeGatewayClientError();
      if (operation.operation === "bootstrap") {
        if (!object(result.map) || !Array.isArray(result.map.objects) || typeof result.map.floor !== "string" ||
          !object(result.clientState) || Object.values(result.clientState).some(item => typeof item !== "string")) throw new OfficeGatewayClientError();
        return { map: result.map, clientState: result.clientState };
      }
      return result;
    }
    try { return await Promise.race([transfer(), deadline]); }
    catch (error) { throw error instanceof OfficeGatewayClientError ? error : new OfficeGatewayClientError(); }
    finally { if (timer) clearTimeout(timer); controller.abort(); }
  }
  return {
    async bootstrap(identity) { return await send({ operation: "bootstrap", identity }) as OfficeGatewayBootstrap; },
    async interface(identity, method, endpoint, body, query) {
      if (method === "GET" && endpoint === "bootstrap") return await send({ operation: "bootstrap", identity }) as Record<string, unknown>;
      return await send({ operation: "interface", identity, method, endpoint,
        ...(body === undefined ? {} : { body }), ...(query === undefined ? {} : { query }) }) as Record<string, unknown>;
    },
    async asset(identity, relativePath) { return await send({ operation: "asset", identity, path: relativePath }) as LoadedOfficeAsset; },
    async avatar(identity, kind, recipe) { return await send({ operation: "avatar", identity, kind, recipe }) as { bytes: Buffer }; },
  };
}
