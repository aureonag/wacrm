import { NextResponse } from "next/server";
import { OFFICE_GATEWAY_LIMITS, OfficeGatewayContractError, parseStoreOperation } from "@/lib/office/gateway/contracts";
import {
  createOfficeGatewayProtocol, decodeOfficeGatewayKey, OFFICE_GATEWAY_HEADERS, OfficeGatewayError,
  type OfficeGatewayProtocol,
} from "@/lib/office/gateway/protocol";
import { OfficeGatewayBodyError, readOfficeGatewayBytes } from "@/lib/office/gateway/client";
import { claimOfficeBackendNonce, getOfficeBackendStore, requireOfficeBackendStoreScope } from "@/lib/office/gateway/store-server";
import { OfficeStoreError } from "@/lib/office/runtime/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" };
let verifier: OfficeGatewayProtocol | undefined;

/** The protocol rejects local replay; migration 157 claims the nonce across Business workers. */
function protocol() {
  if (!verifier) verifier = createOfficeGatewayProtocol({
    key: decodeOfficeGatewayKey(process.env.AUREON_OFFICE_GATEWAY_KEY), audience: "store",
  });
  return verifier;
}
function json(value: unknown, status = 200) {
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text) > OFFICE_GATEWAY_LIMITS.storeRequestBytes) throw new OfficeStoreError("OFFICE_STORAGE_UNAVAILABLE");
  return new NextResponse(text, { status, headers: { ...headers, "Content-Type": "application/json" } });
}
function failure(error: unknown) {
  const status = error instanceof OfficeGatewayBodyError ? error.kind === "limit" ? 413 : error.kind === "invalid" ? 400 : 503 :
    error instanceof OfficeGatewayError || error instanceof OfficeGatewayContractError || error instanceof OfficeStoreError ? error.status : 503;
  return json({ error: status === 503 ? "Office storage callback is unavailable" : "Office storage callback request was rejected",
    code: status === 503 ? "OFFICE_BACKEND_STORE_UNAVAILABLE" : "OFFICE_BACKEND_STORE_REJECTED" }, status);
}

/** Fixed HMAC audience/path. Never calls CRM browser login, accepts a cookie, or logs a snapshot. */
export async function POST(request: Request) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new OfficeStoreError("OFFICE_STORAGE_UNAVAILABLE")); }, OFFICE_GATEWAY_LIMITS.timeoutMs);
  });
  async function dispatch() {
    const accountId = requireOfficeBackendStoreScope();
    const signedProtocol = protocol();
    if (Object.values(OFFICE_GATEWAY_HEADERS).some(header => !request.headers.has(header))) throw new OfficeGatewayError(401);
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") || "")) throw new OfficeGatewayContractError();
    const bytes = await readOfficeGatewayBytes(request, OFFICE_GATEWAY_LIMITS.storeRequestBytes, controller.signal);
    const url = new URL(request.url);
    signedProtocol.verify({ method: request.method, path: url.pathname + url.search, body: bytes, headers: request.headers });
    let value: unknown;
    try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { throw new OfficeGatewayContractError(); }
    const operation = parseStoreOperation(value);
    if (operation.accountId.toLowerCase() !== accountId) throw new OfficeGatewayContractError(403);
    const nonce = request.headers.get(OFFICE_GATEWAY_HEADERS.nonce);
    const timestamp = request.headers.get(OFFICE_GATEWAY_HEADERS.timestamp);
    if (nonce === null || !/^[0-9a-f]{32}$/.test(nonce) || timestamp === null ||
      !/^(0|[1-9][0-9]{0,15})$/.test(timestamp) || !Number.isSafeInteger(Number(timestamp))) {
      throw new OfficeStoreError("OFFICE_STORAGE_UNAVAILABLE");
    }
    const claimed = await claimOfficeBackendNonce(accountId, nonce, Number(timestamp));
    if (controller.signal.aborted) throw new OfficeStoreError("OFFICE_STORAGE_UNAVAILABLE");
    if (claimed === false) throw new OfficeGatewayError(401);
    if (claimed !== true) throw new OfficeStoreError("OFFICE_STORAGE_UNAVAILABLE");
    const store = getOfficeBackendStore();
    if (operation.operation === "load") {
      const record = await store.load(accountId);
      return json({ record: { revision: record.revision, snapshot: record.snapshot } });
    }
    const committed = await store.compareAndSwap(accountId, operation.expectedRevision, operation.nextSnapshot);
    if (typeof committed !== "boolean") throw new OfficeStoreError("OFFICE_STORAGE_UNAVAILABLE");
    return json({ committed });
  }
  try { return await Promise.race([dispatch(), deadline]); }
  catch (error) { return failure(error); }
  finally { if (timer) clearTimeout(timer); controller.abort(); }
}
