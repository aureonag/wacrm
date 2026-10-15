import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { createOfficeGatewayProtocol, OfficeGatewayError, OFFICE_GATEWAY_PATHS } from "./protocol";
import { OFFICE_GATEWAY_LIMITS, OfficeGatewayContractError, parseRuntimeOperation } from "./contracts";
import { createOfficeStoreCallback, OfficeStoreCallbackError } from "./store-callback";
import { createCrmInterfaceService, OfficeRuntimeError } from "../runtime/service.cjs";
import { createOfficeAssetLoader, OfficeAssetError } from "../runtime/assets";
import { createOfficeAvatarComposer, OfficeAvatarError } from "../runtime/avatar-composition";

export class OfficeGatewayServerError extends Error {
  readonly status = 503;
  readonly code = "OFFICE_GATEWAY_UNAVAILABLE";
  constructor() { super("Office gateway is unavailable"); this.name = "OfficeGatewayServerError"; }
}
const privateHeaders = { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" };
type Reply = { status: number; body: Buffer; contentType: string; etag?: string };
const json = (status: number, body: unknown): Reply => {
  const bytes = Buffer.from(JSON.stringify(body), "utf8");
  if (bytes.length > OFFICE_GATEWAY_LIMITS.runtimeJsonResponseBytes) throw new OfficeGatewayServerError();
  return { status, body: bytes, contentType: "application/json; charset=utf-8" };
};
function errorReply(error: unknown): Reply {
  let status = 500, code = "OFFICE_GATEWAY_FAILURE";
  if (error instanceof OfficeGatewayError || error instanceof OfficeGatewayContractError ||
      error instanceof OfficeGatewayServerError || error instanceof OfficeStoreCallbackError ||
      error instanceof OfficeAssetError || error instanceof OfficeAvatarError) {
    status = error.status; code = error.code;
  } else if (error instanceof OfficeRuntimeError && [400, 403, 404, 405, 409, 413, 429, 503].includes(error.status)) {
    status = error.status; code = "OFFICE_OPERATION_REJECTED";
  }
  const messages: Record<number, string> = { 400: "Solicitação inválida.", 401: "Gateway não autorizado.",
    403: "Ação não permitida.", 404: "Recurso não encontrado.", 405: "Método não permitido.",
    409: "O escritório foi atualizado. Recarregue e tente novamente.", 413: "Conteúdo excede o limite.",
    429: "Escritório ocupado. Tente novamente.", 502: "Não foi possível carregar o recurso.", 503: "O escritório está indisponível." };
  return json(status, { error: messages[status] || "Não foi possível executar a operação.", code });
}
async function readBody(request: IncomingMessage): Promise<Buffer> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] || "") || request.headers["content-encoding"]) throw new OfficeGatewayContractError();
  const announced = request.headers["content-length"];
  if (announced !== undefined && (!/^\d+$/.test(announced) || Number(announced) > OFFICE_GATEWAY_LIMITS.runtimeRequestBytes)) throw new OfficeGatewayContractError(413);
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []; let length = 0;
    const cleanup = () => { clearTimeout(timer); request.off("data", data); request.off("end", end); request.off("error", error); request.off("aborted", aborted); };
    const fail = (reason: Error) => { cleanup(); request.resume(); reject(reason); };
    const data = (chunk: Buffer) => {
      const bytes = Buffer.from(chunk); length += bytes.length;
      if (length > OFFICE_GATEWAY_LIMITS.runtimeRequestBytes) { fail(new OfficeGatewayContractError(413)); return; }
      chunks.push(bytes);
    };
    const end = () => { cleanup(); resolve(Buffer.concat(chunks, length)); };
    const error = () => fail(new OfficeGatewayContractError());
    const aborted = () => fail(new OfficeGatewayContractError());
    const timer = setTimeout(error, OFFICE_GATEWAY_LIMITS.timeoutMs);
    request.on("data", data); request.once("end", end); request.once("error", error); request.once("aborted", aborted);
  });
}
function parseJsonBody(raw: Buffer): unknown {
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)) as unknown; }
  catch { throw new OfficeGatewayContractError(); }
}
async function writeReply(response: ServerResponse, reply: Reply) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(reply.status, { ...privateHeaders, "Content-Type": reply.contentType,
    "Content-Length": String(reply.body.length), ...(reply.etag ? { ETag: reply.etag } : {}) });
  await new Promise<void>(resolve => {
    const done = () => { response.off("finish", done); response.off("close", done); response.off("error", done); resolve(); };
    response.once("finish", done); response.once("close", done); response.once("error", done); response.end(reply.body);
  });
}
/** Unbound, single-process server. The entrypoint binds loopback unless explicitly told otherwise. */
export function createOfficeGatewayServer({ enabled, key, storeCallbackUrl, runtimeDirectory, approvedMap,
  allowInsecureLocalhost = false, fetchImpl = fetch, now, maxInFlight = 32 }: {
  enabled?: string; key: Uint8Array; storeCallbackUrl: string; runtimeDirectory: string;
  approvedMap: Record<string, unknown>; allowInsecureLocalhost?: boolean; fetchImpl?: typeof fetch;
  now?: () => number; maxInFlight?: number;
}) {
  if (typeof runtimeDirectory !== "string" || !path.isAbsolute(runtimeDirectory) ||
      !Number.isInteger(maxInFlight) || maxInFlight < 1 || maxInFlight > 128) throw new OfficeGatewayServerError();
  const protocol = createOfficeGatewayProtocol({ key, audience: "runtime", now });
  const store = createOfficeStoreCallback({ url: storeCallbackUrl, key, fetchImpl, allowInsecureLocalhost, now });
  const service = createCrmInterfaceService({ store, approvedMap, now });
  const assets = createOfficeAssetLoader({ directory: runtimeDirectory, requireCrmBootstrap: true });
  const composer = createOfficeAvatarComposer({ fetchImpl, loadLibrary: async () => {
    const loaded = await assets.load("assets/gather/avatar/native-library-manifest.json");
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(loaded.bytes)) as unknown;
  } });
  let inFlight = 0;
  const server = createServer({ maxHeaderSize: 16 * 1024 }, async (request, response) => {
    if (request.url !== OFFICE_GATEWAY_PATHS.runtime) {
      await writeReply(response, json(404, { error: "Recurso não encontrado.", code: "OFFICE_GATEWAY_NOT_FOUND" })); return;
    }
    if (request.method !== "POST") {
      await writeReply(response, json(405, { error: "Método não permitido.", code: "OFFICE_GATEWAY_METHOD" })); return;
    }
    if (enabled !== "true") { await writeReply(response, errorReply(new OfficeGatewayServerError())); return; }
    if (inFlight >= maxInFlight) {
      await writeReply(response, json(429, { error: "Escritório ocupado. Tente novamente.", code: "OFFICE_GATEWAY_BUSY" })); return;
    }
    ++inFlight;
    try {
      const raw = await readBody(request);
      const headers: [string, string][] = [];
      for (let i = 0; i < request.rawHeaders.length; i += 2) headers.push([request.rawHeaders[i], request.rawHeaders[i + 1]]);
      protocol.verify({ method: request.method, path: request.url, body: raw, headers });
      const operation = parseRuntimeOperation(parseJsonBody(raw));
      let result: Reply;
      if (operation.operation === "bootstrap") {
        const data = await service.requestAsCrm(operation.identity, "GET", "/bootstrap");
        result = json(200, { ...data, identity: operation.identity });
      } else if (operation.operation === "interface") {
        result = json(200, await service.requestAsCrm(operation.identity, operation.method, "/" + operation.endpoint, operation.body, operation.query));
      } else if (operation.operation === "asset") {
        const asset = await assets.load(operation.path);
        if (asset.bytes.length > OFFICE_GATEWAY_LIMITS.assetResponseBytes || !/^"[0-9a-f]{64}"$/.test(asset.etag)) throw new OfficeGatewayServerError();
        result = { status: 200, body: asset.bytes, contentType: asset.contentType, etag: asset.etag };
      } else {
        const avatar = await composer.load(operation.kind, operation.recipe);
        if (avatar.bytes.length > OFFICE_GATEWAY_LIMITS.avatarResponseBytes) throw new OfficeGatewayServerError();
        result = { status: 200, body: avatar.bytes, contentType: "image/png" };
      }
      await writeReply(response, result);
    } catch (error) { if (!response.headersSent) response.setHeader("Connection", "close"); await writeReply(response, errorReply(error)); }
    finally { --inFlight; }
  });
  server.requestTimeout = OFFICE_GATEWAY_LIMITS.timeoutMs;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  // A socket error is not a reason to dump headers, actor DTOs, keys or bodies.
  server.on("clientError", (_error, socket) => { socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"); });
  return server;
}
