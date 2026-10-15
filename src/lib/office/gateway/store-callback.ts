import type { OfficeRuntimeStore } from "../runtime/service.cjs";
import { createOfficeGatewayProtocol, OFFICE_GATEWAY_PATHS } from "./protocol";
import { AUREON_OFFICE_ACCOUNT_ID, OFFICE_GATEWAY_LIMITS, parseStoreOperation } from "./contracts";

export class OfficeStoreCallbackError extends Error {
  readonly status = 503;
  readonly code = "OFFICE_STORE_UNAVAILABLE";
  constructor() { super("Office persistence is unavailable"); this.name = "OfficeStoreCallbackError"; }
}
function unavailable(): never { throw new OfficeStoreCallbackError(); }
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** Fixed CRM callback only. The insecure option is an explicit loopback test dependency, never an env switch. */
export function createOfficeStoreCallback({ url, key, fetchImpl = fetch, allowInsecureLocalhost = false,
  timeoutMs = OFFICE_GATEWAY_LIMITS.timeoutMs, now }: {
  url: string; key: Uint8Array; fetchImpl?: typeof fetch; allowInsecureLocalhost?: boolean;
  timeoutMs?: number; now?: () => number;
}): OfficeRuntimeStore {
  let endpoint: URL;
  try { endpoint = new URL(url); } catch { unavailable(); }
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname);
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || endpoint.pathname !== OFFICE_GATEWAY_PATHS.store ||
      !(endpoint.protocol === "https:" && endpoint.hostname === "aureonag.com" && !endpoint.port ||
        allowInsecureLocalhost && local && endpoint.protocol === "http:") ||
      !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > OFFICE_GATEWAY_LIMITS.timeoutMs) unavailable();
  const protocol = createOfficeGatewayProtocol({ key, audience: "store", now });

  async function request(operation: unknown): Promise<unknown> {
    const payload = parseStoreOperation(operation);
    const signed = protocol.sign(Buffer.from(JSON.stringify(payload), "utf8"));
    if (signed.body.length > OFFICE_GATEWAY_LIMITS.storeRequestBytes) unavailable();
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); void reader?.cancel().catch(() => {}); reject(new OfficeStoreCallbackError()); }, timeoutMs);
    });
    const operationPromise = (async () => {
      const response = await fetchImpl(endpoint.href, { method: "POST", body: new Uint8Array(signed.body),
        headers: { "Content-Type": "application/json", ...signed.headers },
        signal: controller.signal, redirect: "error", credentials: "omit", cache: "no-store" });
      try {
        if (controller.signal.aborted || response.status !== 200 || response.redirected ||
            response.url && response.url !== endpoint.href ||
            !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") || "")) unavailable();
        const length = response.headers.get("content-length");
        if (length !== null && (!/^\d+$/.test(length) || Number(length) > OFFICE_GATEWAY_LIMITS.storeRequestBytes)) unavailable();
        if (!response.body) unavailable();
        reader = response.body.getReader();
        const chunks: Buffer[] = []; let size = 0, reads = 0;
        for (;;) {
          if (controller.signal.aborted || ++reads > 4096) unavailable();
          const chunk = await reader.read();
          if (controller.signal.aborted) unavailable();
          if (chunk.done) break;
          if (!(chunk.value instanceof Uint8Array)) unavailable();
          size += chunk.value.byteLength;
          if (size > OFFICE_GATEWAY_LIMITS.storeRequestBytes) unavailable();
          chunks.push(Buffer.from(chunk.value));
        }
        return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size))) as unknown;
      } finally {
        if (reader) { void reader.cancel().catch(() => {}); try { reader.releaseLock(); } catch { /* timed-out read may settle later */ } }
        else void response.body?.cancel().catch(() => {});
      }
    })();
    try { return await Promise.race([operationPromise, timeout]); }
    catch { controller.abort(); void reader?.cancel().catch(() => {}); unavailable(); }
    finally { if (timer !== undefined) clearTimeout(timer); }
  }
  return {
    async load(accountId) {
      const result = await request({ operation: "load", accountId });
      if (!object(result) || Object.keys(result).length !== 1 || !object(result.record)) unavailable();
      const record = result.record;
      if (Object.keys(record).sort().join(",") !== "revision,snapshot" || !Number.isSafeInteger(record.revision) ||
          (record.revision as number) < 0 || !(record.snapshot === null || object(record.snapshot)) ||
          object(record.snapshot) && record.snapshot.accountId !== undefined && record.snapshot.accountId !== AUREON_OFFICE_ACCOUNT_ID) unavailable();
      return structuredClone(record) as { revision: number; snapshot: Record<string, unknown> | null };
    },
    async compareAndSwap(accountId, expectedRevision, nextSnapshot) {
      const result = await request({ operation: "compareAndSwap", accountId, expectedRevision, nextSnapshot });
      if (!object(result) || Object.keys(result).length !== 1 || typeof result.committed !== "boolean") unavailable();
      return result.committed;
    },
  };
}
