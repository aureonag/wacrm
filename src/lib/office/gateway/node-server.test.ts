import { afterEach, describe, expect, it } from "vitest";
import { createServer, request as httpRequest, type Server } from "node:http";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { OfficeContext } from "../access";
import { createOfficeGatewayServer } from "./node-server";
import { AUREON_OFFICE_ACCOUNT_ID as ACCOUNT, OFFICE_GATEWAY_LIMITS, parseRuntimeOperation, parseStoreOperation } from "./contracts";
import { createOfficeGatewayProtocol } from "./protocol";

const KEY = Buffer.alloc(32, 71); // Fictional test key, never configuration.
const USER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", USER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const identity = (id = USER_A): OfficeContext => ({ accountId: ACCOUNT, user: { id,
  profileId: id, name: id === USER_A ? "Ana fixture" : "Bruno fixture", avatarUrl: null },
  role: "agent", capabilities: { canDecorate: false, canManageMembers: false } });
const approvedMap = { objects: [], floor: "#a27f6b", construction: [] };
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
async function listen(server: Server) {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const address = server.address(); if (!address || typeof address === "string") throw Error("fixture bind failed");
  return "http://127.0.0.1:" + address.port;
}
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
async function bundle() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "aureon-gateway-"));
  cleanups.push(async () => {
    const absolute = path.resolve(directory);
    expect(path.dirname(absolute)).toBe(path.resolve(os.tmpdir())); expect(path.basename(absolute)).toMatch(/^aureon-gateway-/);
    expect((await fs.lstat(absolute)).isSymbolicLink()).toBe(false); await fs.rm(absolute, { recursive: true });
  });
  const files = { "index.html": Buffer.from("<!doctype html><p>Private fixture</p>"), "app.js": Buffer.from("/* fixture only */"),
    "assets/gather/avatar/native-library-manifest.json": Buffer.from(JSON.stringify({ categories: [{ id: "hair", items: [{ variants: [{ wearableId: "deadbeef" }] }] }] })) };
  for (const [name, bytes] of Object.entries(files)) { await fs.mkdir(path.dirname(path.join(directory, name)), { recursive: true }); await fs.writeFile(path.join(directory, name), bytes); }
  await fs.writeFile(path.join(directory, "manifest.json"), JSON.stringify({ version: 1, mode: "written", crmBootstrapVersion: 1, crmSessionRequired: true,
    fileCount: Object.keys(files).length, files: Object.entries(files).map(([name, bytes]) => ({ path: name, bytes: bytes.length, sha256: hash(bytes) })) }));
  return { directory, files };
}
async function fixture(options: { enabled?: string; maxInFlight?: number; avatarFetch?: typeof fetch } = {}) {
  const packaged = await bundle();
  const storeProtocol = createOfficeGatewayProtocol({ key: KEY, audience: "store" });
  let record: { revision: number; snapshot: Record<string, unknown> | null } = { revision: 0, snapshot: null };
  let conflict = false, fail = false; const calls: string[] = [], receivedHeaders: Record<string, unknown>[] = [];
  let hold: (() => Promise<void>) | undefined;
  const storeServer = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks); storeProtocol.verify({ method: request.method!, path: request.url!, body, headers: request.headers });
      const op = parseStoreOperation(JSON.parse(body.toString("utf8"))); calls.push(op.operation); receivedHeaders.push(request.headers);
      await hold?.(); if (fail) { response.writeHead(500, { "Content-Type": "application/json" }); response.end('{"private":"database password fixture must never escape"}'); return; }
      if (op.operation === "load") { response.writeHead(200, { "Content-Type": "application/json" }); response.end(JSON.stringify({ record })); }
      else { const committed = !conflict && op.expectedRevision === record.revision; conflict = false;
        if (committed) record = { revision: op.expectedRevision + 1, snapshot: structuredClone(op.nextSnapshot) };
        response.writeHead(200, { "Content-Type": "application/json" }); response.end(JSON.stringify({ committed })); }
    } catch { response.writeHead(401, { "Content-Type": "application/json" }); response.end('{"error":"fixture rejected"}'); }
  });
  const storeOrigin = await listen(storeServer);
  const fetchImpl: typeof fetch = options.avatarFetch ? ((input, init) => String(input).startsWith("https://sprite.v2.gather.town/") ? options.avatarFetch!(input, init) : fetch(input, init)) : fetch;
  const server = createOfficeGatewayServer({ enabled: options.enabled ?? "true", key: KEY,
    storeCallbackUrl: storeOrigin + "/api/office/backend-store", allowInsecureLocalhost: true,
    runtimeDirectory: packaged.directory, approvedMap, maxInFlight: options.maxInFlight, fetchImpl });
  const origin = await listen(server), signer = createOfficeGatewayProtocol({ key: KEY, audience: "runtime" });
  const signed = (value: unknown) => signer.sign(Buffer.from(JSON.stringify(value)));
  const send = async (value: unknown) => { const message = signed(value); return fetch(origin + "/v1/runtime", {
    method: "POST", headers: { "Content-Type": "application/json", ...message.headers }, body: new Uint8Array(message.body) }); };
  return { ...packaged, origin, server, send, signed, calls, receivedHeaders, peek: () => structuredClone(record), conflict: () => { conflict = true; },
    fail: () => { fail = true; }, hold: (value?: () => Promise<void>) => { hold = value; } };
}

describe("dedicated office gateway: two fictional loopback HTTP servers", () => {
  it("bootstraps stable CRM actors and persists chat through the authenticated callback, never exposing a snapshot", async () => {
    const h = await fixture();
    const boot = await h.send({ operation: "bootstrap", identity: identity() }); expect(boot.status).toBe(200);
    expect(await boot.json()).toEqual({ identity: identity(), map: approvedMap, clientState: {} });
    expect(h.calls).toEqual(["load", "compareAndSwap"]);
    await h.send({ operation: "bootstrap", identity: identity(USER_B) });
    const sent = await h.send({ operation: "interface", identity: identity(), method: "POST", endpoint: "messages", body: { conversation: "channel:general", text: "Fixture hello" } });
    expect(sent.status).toBe(200);
    const read = await h.send({ operation: "interface", identity: identity(USER_B), method: "GET", endpoint: "messages", query: { conversation: "channel:general" } });
    expect((await read.json()).messages).toEqual([expect.objectContaining({ text: "Fixture hello", author: USER_A })]);
    expect(h.receivedHeaders.every(headers => !headers.cookie && !headers.authorization)).toBe(true);
    expect(boot.headers.get("cache-control")).toContain("no-store"); expect(boot.headers.get("set-cookie")).toBeNull();
  });
  it("keeps a warm spatial publish off the callback and uses a durable callback for heartbeat", async () => {
    const h = await fixture(); await h.send({ operation: "bootstrap", identity: identity() }); h.calls.length = 0;
    for (let i = 0; i < 20; i++) expect((await h.send({ operation: "interface", identity: identity(), method: "POST", endpoint: "spatial-presence", body: { x: 224 + i, y: 368 } })).status).toBe(200);
    expect(h.calls).toEqual([]);
    expect((await h.send({ operation: "interface", identity: identity(), method: "POST", endpoint: "heartbeat" })).status).toBe(200);
    expect(h.calls[0]).toBe("load");
  });
  it("serves only manifest-verified bytes and MIME, with no path/source fallback", async () => {
    const h = await fixture();
    const asset = await h.send({ operation: "asset", identity: identity(), path: "index.html" });
    expect(asset.status).toBe(200); expect(Buffer.from(await asset.arrayBuffer())).toEqual(h.files["index.html"]);
    expect(asset.headers.get("content-type")).toBe("text/html; charset=utf-8"); expect(asset.headers.get("etag")).toBe('"' + hash(h.files["index.html"]) + '"');
    for (const name of ["../.env", "manifest.json", "missing.png", "https://evil.invalid/a.png"]) expect((await h.send({ operation: "asset", identity: identity(), path: name })).status).toBe(404);
    await fs.writeFile(path.join(h.directory, "app.js"), "corrupted");
    expect((await h.send({ operation: "asset", identity: identity(), path: "app.js" })).status).toBe(503);
  });
  it("composes only known avatar recipes via the existing fixed CDN fetch", async () => {
    const urls: string[] = []; const png = Buffer.alloc(33); Buffer.from([137,80,78,71,13,10,26,10]).copy(png); png.writeUInt32BE(13,8); png.write("IHDR",12); png.writeUInt32BE(2304,16); png.writeUInt32BE(64,20);
    const h = await fixture({ avatarFetch: async input => { urls.push(String(input)); return new Response(png, { headers: { "Content-Type": "image/png" } }); } });
    const avatar = await h.send({ operation: "avatar", identity: identity(), kind: "essentials", recipe: "deadbeef" });
    expect(avatar.status).toBe(200); expect(avatar.headers.get("content-type")).toBe("image/png"); expect(Buffer.from(await avatar.arrayBuffer())).toEqual(png);
    expect(urls).toEqual(["https://sprite.v2.gather.town/v2/sprite/avatar-deadbeef.20260929T190313Z.png"]);
    expect((await h.send({ operation: "avatar", identity: identity(), kind: "extras", recipe: "not-allowed" })).status).toBe(400);
    expect(urls).toHaveLength(1);
  });
  it("rejects unsigned, replayed, cross-audience and tampered requests before touching the store", async () => {
    const h = await fixture(), payload = { operation: "bootstrap", identity: identity() };
    expect((await fetch(h.origin + "/v1/runtime", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })).status).toBe(401);
    const valid = h.signed(payload);
    expect((await fetch(h.origin + "/v1/runtime", { method: "POST", headers: { "Content-Type": "application/json", ...valid.headers }, body: new Uint8Array(valid.body) })).status).toBe(200);
    const count = h.calls.length;
    expect((await fetch(h.origin + "/v1/runtime", { method: "POST", headers: { "Content-Type": "application/json", ...valid.headers }, body: new Uint8Array(valid.body) })).status).toBe(401);
    const other = createOfficeGatewayProtocol({ key: KEY, audience: "store" }).sign(JSON.stringify(payload));
    expect((await fetch(h.origin + "/v1/runtime", { method: "POST", headers: { "Content-Type": "application/json", ...other.headers }, body: new Uint8Array(other.body) })).status).toBe(401);
    const changed = h.signed(payload); expect((await fetch(h.origin + "/v1/runtime", { method: "POST", headers: { "Content-Type": "application/json", ...changed.headers }, body: Buffer.concat([changed.body, Buffer.from(" ")]) })).status).toBe(401);
    expect(h.calls).toHaveLength(count);
  });
  it("rejects scope/role/unknown envelopes and does not create local name sessions", async () => {
    const h = await fixture();
    const wrong = identity(); wrong.accountId = "11111111-1111-4111-8111-111111111111";
    expect((await h.send({ operation: "bootstrap", identity: wrong })).status).toBe(403);
    const forged = identity(); forged.capabilities.canDecorate = true;
    expect((await h.send({ operation: "bootstrap", identity: forged })).status).toBe(400);
    expect((await h.send({ operation: "signup", identity: identity(), name: "Owner" })).status).toBe(400);
    expect((await h.send({ operation: "interface", identity: identity(), method: "POST", endpoint: "session", body: { name: "Owner" } })).status).toBe(403);
    expect(h.calls).toEqual([]);
  });
  it("keeps classified business conflict/403 errors safe and distinct from CRM access logout", async () => {
    const h = await fixture(); await h.send({ operation: "bootstrap", identity: identity() });
    h.conflict(); const conflict = await h.send({ operation: "interface", identity: identity(), method: "POST", endpoint: "messages", body: { conversation: "channel:general", text: "Not committed" } });
    expect(conflict.status).toBe(409); expect(await conflict.json()).toMatchObject({ code: "OFFICE_OPERATION_REJECTED" });
    const denied = await h.send({ operation: "interface", identity: identity(), method: "POST", endpoint: "meeting-action", body: { id: "missing", action: "join" } });
    expect([403,404]).toContain(denied.status); expect((await denied.json()).code).not.toBe("OFFICE_ACCESS_DENIED");
    h.fail(); const failed = await h.send({ operation: "interface", identity: identity(), method: "GET", endpoint: "state" });
    expect(failed.status).toBe(503); expect(await failed.text()).not.toMatch(/password|database|fixture must/);
  });
  it("has only the fixed POST path, an exact enabled flag, bounded raw input and invalid JSON400", async () => {
    const disabled = await fixture({ enabled: "TRUE" });
    expect((await disabled.send({ operation: "bootstrap", identity: identity() })).status).toBe(503); expect(disabled.calls).toEqual([]);
    const h = await fixture();
    for (const route of ["/", "/health", "/v1/runtime?x=1", "/v1/runtime/", "/signup"]) expect((await fetch(h.origin + route)).status).toBe(404);
    expect((await fetch(h.origin + "/v1/runtime")).status).toBe(405);
    expect((await fetch(h.origin + "/v1/runtime", { method: "POST", headers: { "Content-Type": "application/json" }, body: "x".repeat(OFFICE_GATEWAY_LIMITS.runtimeRequestBytes + 1) })).status).toBe(413);
    const streamedStatus = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(h.origin + "/v1/runtime", { method: "POST", headers: { "Content-Type": "application/json" } }, response => { response.resume(); resolve(response.statusCode!); });
      req.once("error", reject); req.write(Buffer.alloc(OFFICE_GATEWAY_LIMITS.runtimeRequestBytes + 1)); req.end();
    });
    expect(streamedStatus).toBe(413);
    const invalid = createOfficeGatewayProtocol({ key: KEY, audience: "runtime" }).sign("{");
    const result = await fetch(h.origin + "/v1/runtime", { method: "POST", headers: { "Content-Type": "application/json", ...invalid.headers }, body: new Uint8Array(invalid.body) });
    expect(result.status).toBe(400); expect(h.calls).toEqual([]);
  });
  it("caps active HTTP work and releases capacity after failures", async () => {
    const h = await fixture({ maxInFlight: 1 }); let release!: () => void, entered!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; }); const started = new Promise<void>(resolve => { entered = resolve; });
    h.hold(async () => { entered(); await blocked; }); const pending = h.send({ operation: "bootstrap", identity: identity() }); await started;
    expect((await h.send({ operation: "bootstrap", identity: identity(USER_B) })).status).toBe(429);
    h.hold(); release(); expect((await pending).status).toBe(200);
    expect((await h.send({ operation: "interface", identity: identity(), method: "POST", endpoint: "session" })).status).toBe(403);
    expect((await h.send({ operation: "bootstrap", identity: identity(USER_B) })).status).toBe(200);
  });
  it("checks duplicate raw signature headers rather than normalizing them away", async () => {
    const h = await fixture(), signed = h.signed({ operation: "bootstrap", identity: identity() });
    const status = await new Promise<number>(resolve => { const req = httpRequest(h.origin + "/v1/runtime", { method: "POST", headers: { "Content-Type": "application/json", ...signed.headers,
      "x-aureon-office-gateway-signature": [signed.headers["x-aureon-office-gateway-signature"], signed.headers["x-aureon-office-gateway-signature"]] } }, response => { response.resume(); resolve(response.statusCode!); }); req.end(signed.body); });
    expect(status).toBe(401); expect(h.calls).toEqual([]);
  });
});
describe("pure gateway contract boundaries", () => {
  it("rejects malformed input, unexpected fields and oversized interface bodies", () => {
    for (const value of [null, [], { operation: "bootstrap", identity: identity(), token: "forged" },
      { operation: "interface", identity: identity(), method: "DELETE", endpoint: "state" },
      { operation: "interface", identity: identity(), method: "GET", endpoint: "../state" },
      { operation: "interface", identity: identity(), method: "POST", endpoint: "profile", body: { bio: "x".repeat(512 * 1024) } }]) expect(() => parseRuntimeOperation(value)).toThrow();
    expect(() => parseStoreOperation({ operation: "compareAndSwap", accountId: ACCOUNT, expectedRevision: 0, nextSnapshot: { version: 1, accountId: ACCOUNT, revision: 2 } })).toThrow();
  });
});
