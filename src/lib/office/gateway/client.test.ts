import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OfficeContext } from "../access";
import { AUREON_OFFICE_ACCOUNT_ID, OFFICE_GATEWAY_LIMITS } from "./contracts";
import { createOfficeGatewayProtocol } from "./protocol";
import { createOfficeGatewayClient, OfficeGatewayBodyError, readOfficeGatewayBytes } from "./client";

const key = Buffer.alloc(32, 7);
const identity: OfficeContext = {
  accountId: AUREON_OFFICE_ACCOUNT_ID, role: "admin",
  user: { id: "11111111-1111-4111-8111-111111111111", profileId: "22222222-2222-4222-8222-222222222222", name: "Teste Aureon", avatarUrl: null },
  capabilities: { canDecorate: true, canManageMembers: true },
};
const bootstrap = { map: { objects: [], floor: "#a27f6b" }, clientState: {} };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const fakeFetch = (handler: (url: string, init: RequestInit) => Promise<Response> | Response) =>
  vi.fn(async (input: string | URL | Request, init?: RequestInit) => handler(String(input), init || {})) as unknown as typeof fetch;
const make = (fetcher: typeof fetch) => createOfficeGatewayClient({ url: "https://office.example", key, fetch: fetcher });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("CRM private office gateway client", () => {
  it("signs exact bytes to the fixed path without cookies/tokens and filters bootstrap extras", async () => {
    const verifier = createOfficeGatewayProtocol({ key, audience: "runtime" });
    const seen: Record<string, unknown>[] = [];
    const fetcher = fakeFetch((url, init) => {
      expect(url).toBe("https://office.example/v1/runtime");
      expect(init).toMatchObject({ method: "POST", credentials: "omit", redirect: "error", cache: "no-store" });
      const headers = new Headers(init.headers);
      expect(headers.has("cookie")).toBe(false); expect(headers.has("authorization")).toBe(false);
      const bytes = Buffer.from(init.body as Uint8Array);
      verifier.verify({ method: "POST", path: "/v1/runtime", body: bytes, headers });
      seen.push(JSON.parse(bytes.toString()));
      return json({ ...bootstrap, snapshot: { secret: "never forward a store snapshot" } });
    });
    const client = make(fetcher);
    expect(await client.bootstrap(identity)).toEqual(bootstrap);
    expect(await client.interface(identity, "GET", "bootstrap")).toEqual(bootstrap);
    expect(seen).toEqual([{ operation: "bootstrap", identity }, { operation: "bootstrap", identity }]);
  });

  it("sends a detached, validated server identity and interface arguments", async () => {
    let payload: Record<string, unknown> | undefined;
    const client = make(fakeFetch((_url, init) => { payload = JSON.parse(Buffer.from(init.body as Uint8Array).toString()); return json({ revision: 9 }); }));
    const actor = structuredClone(identity);
    const operation = client.interface(actor, "POST", "messages", { text: "Olá" }, { conversation: "general" });
    actor.user.name = "mutated after call";
    expect(await operation).toEqual({ revision: 9 });
    expect(payload).toEqual({ operation: "interface", identity, method: "POST", endpoint: "messages", body: { text: "Olá" }, query: { conversation: "general" } });
  });

  it.each(["http://office.example", "https://u:p@office.example", "https://office.example/other", "https://office.example/?x=1", "https://office.example/#x"])(
    "rejects unreviewed gateway URL %s", url => {
      expect(() => createOfficeGatewayClient({ url, key, fetch: fakeFetch(() => json({})) })).toThrowError(/indisponível/);
    },
  );
  it("allows insecure loopback only through the explicit test option", async () => {
    expect(() => createOfficeGatewayClient({ url: "http://127.0.0.1", key })).toThrow();
    const client = createOfficeGatewayClient({ url: "http://127.0.0.1:4188/v1/runtime", key, allowInsecureLocalhostForTests: true, fetch: fakeFetch(() => json(bootstrap)) });
    expect(await client.bootstrap(identity)).toEqual(bootstrap);
    expect(() => createOfficeGatewayClient({ url: "http://office.example", key, allowInsecureLocalhostForTests: true })).toThrow();
  });

  it("validates operation and body/query scope before any network call", async () => {
    const fetcher = fakeFetch(() => json({}));
    const client = make(fetcher);
    await expect(client.interface(identity, "DELETE", "state")).rejects.toMatchObject({ status: 400 });
    await expect(client.interface(identity, "GET", "/state")).rejects.toMatchObject({ status: 400 });
    await expect(client.interface(identity, "GET", "state", undefined, { invalid: 9 })).rejects.toMatchObject({ status: 400 });
    await expect(client.interface(identity, "POST", "messages", { text: "x".repeat(OFFICE_GATEWAY_LIMITS.interfaceBodyBytes) })).rejects.toMatchObject({ status: 413 });
    await expect(client.bootstrap({ ...identity, accountId: "33333333-3333-4333-8333-333333333333" })).rejects.toMatchObject({ status: 403 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns only bounded asset metadata, validating MIME and optional ETag", async () => {
    const bytes = Buffer.from("approved asset"), etag = '"' + createHash("sha256").update(bytes).digest("hex") + '"';
    const client = make(fakeFetch(() => new Response(bytes, { headers: {
      "Content-Type": "application/javascript; charset=utf-8", ETag: etag,
      "Set-Cookie": "secret=not-forwarded", Location: "https://other.example", "X-Remote-Secret": "private",
    } })));
    const result = await client.asset(identity, "app.js");
    expect(result).toEqual({ bytes, contentType: "application/javascript; charset=utf-8", size: bytes.length, etag });
    expect(Object.keys(result).sort()).toEqual(["bytes", "contentType", "etag", "size"]);
  });
  it.each([
    { "Content-Type": "text/plain" },
    { "Content-Type": "image/png", ETag: '"incorrect"' },
    { "Content-Type": "image/png", "Content-Length": String(OFFICE_GATEWAY_LIMITS.assetResponseBytes + 1) },
  ] as Record<string, string>[])("rejects invalid asset metadata or excessive announced size", async headers => {
    await expect(make(fakeFetch(() => new Response("x", { headers }))).asset(identity, "app.js")).rejects.toMatchObject({ status: 503 });
  });

  it("validates avatar PNG bytes and the one MiB bound", async () => {
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
    expect(await make(fakeFetch(() => new Response(png, { headers: { "Content-Type": "image/png" } }))).avatar(identity, "essentials", "recipe")).toEqual({ bytes: png });
    await expect(make(fakeFetch(() => new Response("bad", { headers: { "Content-Type": "image/png" } }))).avatar(identity, "essentials", "recipe")).rejects.toMatchObject({ status: 503 });
    await expect(make(fakeFetch(() => new Response(png, { headers: { "Content-Type": "image/png", "Content-Length": String(OFFICE_GATEWAY_LIMITS.avatarResponseBytes + 1) } }))).avatar(identity, "essentials", "recipe")).rejects.toMatchObject({ status: 503 });
  });

  it.each([403, 409])("preserves business status %s without forwarding remote secrets or logout codes", async status => {
    try { await make(fakeFetch(() => json({ error: "SQL_SECRET", code: "OFFICE_ACCESS_DENIED" }, status))).interface(identity, "GET", "state"); }
    catch (error) {
      expect(error).toMatchObject({ status, code: "OFFICE_GATEWAY_OPERATION_FAILED" });
      expect(String(error)).not.toMatch(/SQL_SECRET|OFFICE_ACCESS_DENIED/); return;
    }
    throw new Error("Expected rejection");
  });
  it.each([401, 302, 500])("maps gateway/transport status %s to unavailable, without retry", async status => {
    const fetcher = fakeFetch(() => json({ error: "secret upstream" }, status));
    await expect(make(fetcher).interface(identity, "GET", "state")).rejects.toMatchObject({ status: 503 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(["OFFICE_CALL_SESSION_REPLACED", "OFFICE_CALL_SESSION_MISSING", "OFFICE_SIGNAL_RECIPIENT_STALE"])(
    "keeps the allowlisted signaling conflict %s without remote text", async code => {
      for (const [method, endpoint] of [["GET", "signals"], ["GET", "call-session"], ["POST", "signal"], ["POST", "call-session"]]) {
        const client = make(fakeFetch(() => json({ code, error: "PRIVATE_UPSTREAM_DETAIL", extra: "SECRET" }, 409)));
        try { await client.interface(identity, method, endpoint); }
        catch (error) {
          expect(error).toMatchObject({ status: 409, code });
          expect(String(error)).not.toMatch(/PRIVATE|SECRET/); continue;
        }
        throw Error("Expected signaling conflict");
      }
    },
  );
  it("ignores call conflict codes outside signaling or status409", async () => {
    const code = "OFFICE_CALL_SESSION_REPLACED";
    for (const [method, endpoint] of [["GET", "state"], ["POST", "signals"], ["GET", "signal"]]) {
      await expect(make(fakeFetch(() => json({ code }, 409))).interface(identity, method, endpoint))
        .rejects.toMatchObject({ status: 409, code: "OFFICE_GATEWAY_OPERATION_FAILED" });
    }
    await expect(make(fakeFetch(() => json({ code }, 403))).interface(identity, "GET", "signals"))
      .rejects.toMatchObject({ status: 403, code: "OFFICE_GATEWAY_OPERATION_FAILED" });
    await expect(make(fakeFetch(() => json({ code }, 403))).interface(identity, "GET", "call-session"))
      .rejects.toMatchObject({ status: 403, code: "OFFICE_GATEWAY_OPERATION_FAILED" });
    await expect(make(fakeFetch(() => json({ code }, 409))).asset(identity, "app.js"))
      .rejects.toMatchObject({ status: 409, code: "OFFICE_GATEWAY_OPERATION_FAILED" });
  });
  it("bounds conflict bodies and rejects unknown codes, invalid JSON, MIME and UTF8", async () => {
    const bodies: [BodyInit, Record<string, string>][] = [
      [JSON.stringify({ code: "OFFICE_SESSION_REQUIRED" }), { "Content-Type": "application/json" }],
      [JSON.stringify({ code: "OFFICE_ACCESS_DENIED" }), { "Content-Type": "application/json" }],
      [JSON.stringify({ code: ["OFFICE_CALL_SESSION_REPLACED"] }), { "Content-Type": "application/json" }],
      [JSON.stringify({ code: "OFFICE_CALL_SESSION_REPLACED" }), { "Content-Type": "text/plain" }],
      ["{", { "Content-Type": "application/json" }],
      [new Uint8Array([0xff]), { "Content-Type": "application/json" }],
      [JSON.stringify({ code: "OFFICE_CALL_SESSION_REPLACED", padding: "x".repeat(4096) }), { "Content-Type": "application/json" }],
    ];
    for (const [body, headers] of bodies) {
      await expect(make(fakeFetch(() => new Response(body, { status: 409, headers }))).interface(identity, "GET", "signals"))
        .rejects.toMatchObject({ status: 409, code: "OFFICE_GATEWAY_OPERATION_FAILED" });
    }
  });
  it("cancels a stalled409 error body at the existing transport deadline", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({ cancel }), { status: 409, headers: { "Content-Type": "application/json" } });
    const failed = expect(make(fakeFetch(() => response)).interface(identity, "GET", "signals")).rejects.toMatchObject({ status: 503 });
    await vi.advanceTimersByTimeAsync(OFFICE_GATEWAY_LIMITS.timeoutMs);
    await failed; expect(cancel).toHaveBeenCalledTimes(1);
  });
  it("cancels rejected conflict bodies for MIME, announced size and actual overflow", async () => {
    for (const mode of ["mime", "announced", "streamed"]) {
      const cancel = vi.fn();
      const headers = { "Content-Type": mode === "mime" ? "text/plain" : "application/json",
        ...(mode === "announced" ? { "Content-Length": "5000" } : {}) };
      const response = new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(5000)); }, cancel }), { status: 409, headers });
      await expect(make(fakeFetch(() => response)).interface(identity, "GET", "signals"))
        .rejects.toMatchObject({ status: 409, code: "OFFICE_GATEWAY_OPERATION_FAILED" });
      expect(cancel).toHaveBeenCalledTimes(1);
    }
  });
  it("sanitizes network, malformed JSON and invalid UTF8 responses", async () => {
    const failing = make(fakeFetch(() => { throw new Error("PRIVATE_GATEWAY_KEY"); }));
    await expect(failing.bootstrap(identity)).rejects.toMatchObject({ status: 503, message: "O escritório está temporariamente indisponível." });
    for (const value of ["not-json", Buffer.from([0xff])]) {
      await expect(make(fakeFetch(() => new Response(value, { headers: { "Content-Type": "application/json" } }))).bootstrap(identity)).rejects.toMatchObject({ status: 503 });
    }
  });
  it("enforces the deadline even if fetch never settles", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const client = make(fakeFetch((_url, init) => { signal = init.signal as AbortSignal; return new Promise(() => {}); }));
    const failed = expect(client.bootstrap(identity)).rejects.toMatchObject({ status: 503 });
    await vi.advanceTimersByTimeAsync(OFFICE_GATEWAY_LIMITS.timeoutMs);
    await failed; expect(signal?.aborted).toBe(true);
  });
});

describe("bounded gateway body reader", () => {
  it("counts actual streamed bytes and cancels on overflow even without Content-Length", async () => {
    const cancel = vi.fn();
    const source = new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(5)); }, cancel }));
    await expect(readOfficeGatewayBytes(source, 4)).rejects.toBeInstanceOf(OfficeGatewayBodyError);
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it("cancels a stalled response body when aborted", async () => {
    const cancel = vi.fn(), controller = new AbortController();
    const source = new Response(new ReadableStream<Uint8Array>({ cancel }));
    const failed = expect(readOfficeGatewayBytes(source, 4, controller.signal)).rejects.toMatchObject({ kind: "aborted" });
    controller.abort(); await failed; expect(cancel).toHaveBeenCalledTimes(1);
  });
});

it("aborts and cancels a stalled response body at the transport deadline", async () => {
 vi.useFakeTimers();
 const cancel = vi.fn();
 const response = new Response(new ReadableStream<Uint8Array>({ cancel }), { headers: { "Content-Type": "application/json" } });
 const client = make(fakeFetch(() => response));
 const failed = expect(client.bootstrap(identity)).rejects.toMatchObject({ status: 503 });
 await vi.advanceTimersByTimeAsync(OFFICE_GATEWAY_LIMITS.timeoutMs);
 await failed; expect(cancel).toHaveBeenCalledTimes(1);
});
