import { describe, expect, it, vi } from "vitest";
import { createOfficeStoreCallback } from "./store-callback";
import { AUREON_OFFICE_ACCOUNT_ID as ACCOUNT, OFFICE_GATEWAY_LIMITS } from "./contracts";
import { createOfficeGatewayProtocol } from "./protocol";
const KEY = Buffer.alloc(32, 37); // Fictional key, never deployment configuration.
const URL = "https://aureonag.com/api/office/backend-store";
const snapshot = { version: 1, accountId: ACCOUNT, revision: 1, users: [], channels: [], messages: [], events: [], activity: [], meetings: [] };
const response = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });

describe("native fetch callback to CRM-owned persistence", () => {
  it("requires the fixed HTTPS CRM callback; insecure loopback is opt-in for tests only", () => {
    for (const url of ["http://aureonag.com/api/office/backend-store", "https://evil.invalid/api/office/backend-store", "https://aureonag.com/other", URL + "?key=secret", URL + "#x", "https://user:pass@aureonag.com/api/office/backend-store", "http://127.0.0.1:4194/api/office/backend-store"]) expect(() => createOfficeStoreCallback({ url, key: KEY })).toThrow();
    expect(() => createOfficeStoreCallback({ url: "http://127.0.0.1:4194/api/office/backend-store", key: KEY, allowInsecureLocalhost: true })).not.toThrow();
    expect(() => createOfficeStoreCallback({ url: "http://evil.invalid/api/office/backend-store", key: KEY, allowInsecureLocalhost: true })).toThrow();
    expect(() => createOfficeStoreCallback({ url: URL, key: Buffer.alloc(31) })).toThrow();
  });
  it("signs exact raw bytes with store audience, fixed URL, no redirects/cookies or Supabase credentials", async () => {
    const verify = createOfficeGatewayProtocol({ key: KEY, audience: "store" });
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe(URL); expect(init?.method).toBe("POST"); expect(init?.redirect).toBe("error"); expect(init?.credentials).toBe("omit");
      const headers = new Headers(init?.headers); expect(headers.has("authorization")).toBe(false); expect(headers.has("cookie")).toBe(false);
      const body = init?.body as Uint8Array; verify.verify({ method: "POST", path: "/api/office/backend-store", body, headers });
      expect(JSON.parse(Buffer.from(body).toString())).toEqual({ operation: "load", accountId: ACCOUNT });
      return response({ record: { revision: 0, snapshot: null } });
    });
    expect(await createOfficeStoreCallback({ url: URL, key: KEY, fetchImpl }).load(ACCOUNT)).toEqual({ revision: 0, snapshot: null });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("preserves CAS false rather than retrying, and returns detached records", async () => {
    const record = { revision: 1, snapshot: structuredClone(snapshot) };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(response({ record })).mockResolvedValueOnce(response({ committed: false }));
    const store = createOfficeStoreCallback({ url: URL, key: KEY, fetchImpl });
    const loaded = await store.load(ACCOUNT); loaded.snapshot!.revision = 9; expect(record.snapshot.revision).toBe(1);
    expect(await store.compareAndSwap(ACCOUNT, 0, snapshot)).toBe(false); expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it.each([
    { record: { revision: -1, snapshot: null } }, { record: { revision: 0, snapshot: [] } },
    { record: { revision: 0, snapshot: null }, secret: "private" }, { revision: 0, snapshot: null },
    { record: { revision: 1, snapshot: { accountId: "11111111-1111-4111-8111-111111111111" } } },
  ])("rejects malformed store records without private payloads in errors (%j)", async body => {
    const store = createOfficeStoreCallback({ url: URL, key: KEY, fetchImpl: async () => response(body) });
    await expect(store.load(ACCOUNT)).rejects.toMatchObject({ status: 503, message: "Office persistence is unavailable" });
  });
  it.each([{ committed: "true" }, { committed: true, extra: "private" }, {}])("rejects invalid CAS acknowledgements (%j)", async body => {
    await expect(createOfficeStoreCallback({ url: URL, key: KEY, fetchImpl: async () => response(body) }).compareAndSwap(ACCOUNT, 0, snapshot)).rejects.toMatchObject({ status: 503 });
  });
  it("rejects non-Aureon operations before any network call", async () => {
    const fetchImpl = vi.fn<typeof fetch>(); const store = createOfficeStoreCallback({ url: URL, key: KEY, fetchImpl });
    await expect(store.load("11111111-1111-4111-8111-111111111111")).rejects.toMatchObject({ status: 403 });
    await expect(store.compareAndSwap(ACCOUNT, 4, snapshot)).rejects.toMatchObject({ status: 400 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("rejects status, MIME, redirect, wrong final URL and malformed UTF-8/JSON", async () => {
    const wrongUrl = response({ record: { revision: 0, snapshot: null } }); Object.defineProperty(wrongUrl, "url", { value: "https://evil.invalid/" });
    const redirected = response({ record: { revision: 0, snapshot: null } }); Object.defineProperty(redirected, "redirected", { value: true });
    for (const result of [new Response("database private", { status: 500, headers: { "Content-Type": "application/json" } }), new Response("html", { headers: { "Content-Type": "text/html" } }), wrongUrl, redirected,
      new Response(new Uint8Array([255]), { headers: { "Content-Type": "application/json" } }), new Response("{", { headers: { "Content-Type": "application/json" } })]) {
      await expect(createOfficeStoreCallback({ url: URL, key: KEY, fetchImpl: async () => result }).load(ACCOUNT)).rejects.toMatchObject({ status: 503, message: "Office persistence is unavailable" });
    }
  });
  it("bounds declared and streamed callback bytes and cancels rejected bodies", async () => {
    let cancellations = 0;
    const declared = new Response(new ReadableStream({ cancel: () => { cancellations++; } }), { headers: { "Content-Type": "application/json", "Content-Length": String(OFFICE_GATEWAY_LIMITS.storeRequestBytes + 1) } });
    await expect(createOfficeStoreCallback({ url: URL, key: KEY, fetchImpl: async () => declared }).load(ACCOUNT)).rejects.toMatchObject({ status: 503 });
    expect(cancellations).toBe(1);
    const streamed = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(OFFICE_GATEWAY_LIMITS.storeRequestBytes + 1)); }, cancel: () => { cancellations++; } }), { headers: { "Content-Type": "application/json" } });
    await expect(createOfficeStoreCallback({ url: URL, key: KEY, fetchImpl: async () => streamed }).load(ACCOUNT)).rejects.toMatchObject({ status: 503 });
    expect(cancellations).toBe(2);
  });
  it("enforces a deadline even if fetch ignores abort, with no automatic replay", async () => {
    let resolve!: (value: Response) => void, cancelled = 0;
    const fetchImpl = vi.fn<typeof fetch>(() => new Promise<Response>(done => { resolve = done; }));
    const store = createOfficeStoreCallback({ url: URL, key: KEY, fetchImpl, timeoutMs: 10 });
    await expect(store.load(ACCOUNT)).rejects.toMatchObject({ status: 503 });
    const late = new Response(new ReadableStream({ cancel: () => { cancelled++; } }), { headers: { "Content-Type": "application/json" } });
    resolve(late); await new Promise(setImmediate);
    expect(cancelled).toBe(1); expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
