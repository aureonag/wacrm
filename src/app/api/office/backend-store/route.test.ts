import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUREON_OFFICE_ACCOUNT_ID, OFFICE_GATEWAY_LIMITS } from "@/lib/office/gateway/contracts";
import { createOfficeGatewayProtocol } from "@/lib/office/gateway/protocol";

const mocks = vi.hoisted(() => ({ scope: vi.fn(), claim: vi.fn(), getStore: vi.fn(), load: vi.fn(), cas: vi.fn() }));
vi.mock("@/lib/office/gateway/store-server", () => ({
  requireOfficeBackendStoreScope: () => mocks.scope(),
  claimOfficeBackendNonce: (...args: unknown[]) => mocks.claim(...args),
  getOfficeBackendStore: () => mocks.getStore(),
}));
const key = Buffer.alloc(32, 7), path = "/api/office/backend-store";
const accountId = AUREON_OFFICE_ACCOUNT_ID;
const record = { revision: 2, snapshot: { version: 1, accountId, revision: 2, messages: [{ text: "synthetic fixture" }] } };
const snapshot = { ...record.snapshot, revision: 3 };
function signed(value: unknown, options: { raw?: string; audience?: "runtime" | "store"; url?: string; headers?: Record<string, string>; now?: () => number } = {}) {
  const protocol = createOfficeGatewayProtocol({ key, audience: options.audience || "store", ...(options.now ? { now: options.now } : {}) });
  const signed = protocol.sign(options.raw === undefined ? JSON.stringify(value) : options.raw);
  return new Request(options.url || "https://crm.example" + path, {
    method: "POST", headers: { "Content-Type": "application/json", ...signed.headers, ...options.headers },
    body: signed.body.toString("utf8"),
  });
}
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  vi.stubEnv("AUREON_OFFICE_GATEWAY_KEY", key.toString("hex"));
  mocks.scope.mockReturnValue(accountId); mocks.claim.mockResolvedValue(true);
  mocks.getStore.mockReturnValue({ load: mocks.load, compareAndSwap: mocks.cas });
  mocks.load.mockResolvedValue(record); mocks.cas.mockResolvedValue(true);
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("private HMAC office backend storage callback", () => {
  it("loads only after signature verification, returning the record DTO without generic remote headers", async () => {
    const { POST } = await import("./route");
    const response = await POST(signed({ operation: "load", accountId }, { headers: { Cookie: "ignored-browser-cookie" } }));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ record });
    expect(response.headers.get("cache-control")).toContain("private, no-store");
    expect(response.headers.get("set-cookie")).toBeNull(); expect(response.headers.get("location")).toBeNull();
    expect(mocks.load).toHaveBeenCalledExactlyOnceWith(accountId);
  });

  it.each([true, false])("returns CAS committed=%s without retrying or translating false into success", async committed => {
    mocks.cas.mockResolvedValue(committed);
    const { POST } = await import("./route");
    const response = await POST(signed({ operation: "compareAndSwap", accountId, expectedRevision: 2, nextSnapshot: snapshot }));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ committed });
    expect(mocks.cas).toHaveBeenCalledExactlyOnceWith(accountId, 2, snapshot);
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("rejects browser cookies without a signature before creating a storage client", async () => {
    const { POST } = await import("./route");
    const response = await POST(new Request("https://crm.example" + path, {
      method: "POST", headers: { Cookie: "valid-looking-session", "Content-Type": "application/json" },
      body: JSON.stringify({ operation: "load", accountId }),
    }));
    expect(response.status).toBe(401); expect(mocks.getStore).not.toHaveBeenCalled();
  });
  it("rejects a reused nonce in the same callback process", async () => {
    const { POST } = await import("./route");
    const request = signed({ operation: "load", accountId });
    expect((await POST(request.clone())).status).toBe(200);
    expect((await POST(request)).status).toBe(401);
    expect(mocks.load).toHaveBeenCalledTimes(1);
  });
  it.each([
    { audience: "runtime" as const },
    { url: "https://crm.example/api/office/backend-store?extra=1" },
    { url: "https://crm.example/api/office/backend-store/" },
    { now: () => 1 },
    { headers: { "x-aureon-office-gateway-signature": "0".repeat(64) } },
  ])("rejects wrong audience/path/time/signature", async options => {
    const { POST } = await import("./route");
    const response = await POST(signed({ operation: "load", accountId }, options));
    expect(response.status).toBe(options.url ? 400 : 401); expect(mocks.getStore).not.toHaveBeenCalled();
  });

  it.each([
    [{ operation: "delete", accountId }, 400],
    [{ operation: "load", accountId: "33333333-3333-4333-8333-333333333333" }, 403],
    [{ operation: "load", accountId, snapshot: {} }, 400],
    [{ operation: "compareAndSwap", accountId, expectedRevision: -1, nextSnapshot: snapshot }, 400],
    [{ operation: "compareAndSwap", accountId, expectedRevision: 2, nextSnapshot: { ...snapshot, revision: 9 } }, 400],
  ])("rejects authenticated but invalid operation before touching Supabase", async (operation, status) => {
    const { POST } = await import("./route");
    expect((await POST(signed(operation))).status).toBe(status);
    expect(mocks.getStore).not.toHaveBeenCalled();
  });
  it("rejects signed malformed JSON without parsing or logging snapshots", async () => {
    const { POST } = await import("./route");
    const response = await POST(signed({}, { raw: "{" }));
    expect(response.status).toBe(400); expect(mocks.getStore).not.toHaveBeenCalled();
  });
  it("limits declared request size before reading it or creating a store", async () => {
    const { POST } = await import("./route");
    const response = await POST(signed({ operation: "load", accountId }, { headers: { "Content-Length": String(OFFICE_GATEWAY_LIMITS.storeRequestBytes + 1) } }));
    expect(response.status).toBe(413); expect(mocks.getStore).not.toHaveBeenCalled();
  });
  it("limits actual request bytes when Content-Length is absent", async () => {
    const { POST } = await import("./route");
    const base = signed({ operation: "load", accountId });
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start(c) {
      c.enqueue(new Uint8Array(OFFICE_GATEWAY_LIMITS.storeRequestBytes));
      c.enqueue(new Uint8Array(1));
    }, cancel });
    const request = new Request(base.url, { method: "POST", headers: base.headers, body, duplex: "half" } as RequestInit & { duplex: "half" });
    expect((await POST(request)).status).toBe(413);
    expect(cancel).toHaveBeenCalledTimes(1); expect(mocks.getStore).not.toHaveBeenCalled();
  });
  it("sanitizes database failures and oversized load responses", async () => {
    const { POST } = await import("./route");
    mocks.load.mockRejectedValueOnce(new Error("PRIVATE_SNAPSHOT_SQL_KEY"));
    const failed = await POST(signed({ operation: "load", accountId }));
    expect(failed.status).toBe(503); expect(await failed.text()).not.toContain("PRIVATE_SNAPSHOT_SQL_KEY");
    mocks.load.mockResolvedValueOnce({ revision: 1, snapshot: { value: "x".repeat(OFFICE_GATEWAY_LIMITS.storeRequestBytes) } });
    expect((await POST(signed({ operation: "load", accountId }))).status).toBe(503);
  });
  it.each([undefined, "bad"])("fails closed for missing or malformed gateway key", async value => {
    vi.stubEnv("AUREON_OFFICE_GATEWAY_KEY", value);
    const { POST } = await import("./route");
    expect((await POST(signed({ operation: "load", accountId }))).status).toBe(503);
    expect(mocks.getStore).not.toHaveBeenCalled();
  });
  it("stops when the transport/flag/account scope gate fails", async () => {
    mocks.scope.mockImplementationOnce(() => { throw new Error("PRIVATE_CONFIG"); });
    const { POST } = await import("./route");
    const response = await POST(signed({ operation: "load", accountId }));
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("PRIVATE_CONFIG");
    expect(mocks.getStore).not.toHaveBeenCalled();
  });
});

it("bounds a stalled storage operation without retrying it", async () => {
 vi.useFakeTimers();
 mocks.load.mockReturnValue(new Promise(() => {}));
 const { POST } = await import("./route");
 const pending = POST(signed({ operation: "load", accountId }));
 await vi.advanceTimersByTimeAsync(OFFICE_GATEWAY_LIMITS.timeoutMs);
 expect((await pending).status).toBe(503);
 expect(mocks.load).toHaveBeenCalledTimes(1);
});


describe("durable cross-worker replay gate", () => {
  it.each(["load", "compareAndSwap"] as const)("does not obtain or call a store while %s awaits claim", async operation => {
    let resolveClaim!: (value: boolean) => void;
    const claiming = new Promise<boolean>(resolve => { resolveClaim = resolve; });
    mocks.claim.mockReturnValueOnce(claiming);
    const { POST } = await import("./route");
    const value = operation === "load" ? { operation, accountId }
      : { operation, accountId, expectedRevision: 2, nextSnapshot: snapshot };
    const pending = POST(signed(value));
    await vi.waitFor(() => expect(mocks.claim).toHaveBeenCalledTimes(1));
    expect(mocks.getStore).not.toHaveBeenCalled();
    expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.cas).not.toHaveBeenCalled();
    resolveClaim(true);
    expect((await pending).status).toBe(200);
    expect(mocks.claim.mock.invocationCallOrder[0]).toBeLessThan(mocks.getStore.mock.invocationCallOrder[0]!);
  });

  it("rejects a replay after resetting the callback process, using the shared claim result", async () => {
    mocks.claim.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const request = signed({ operation: "load", accountId });
    const firstWorker = await import("./route");
    expect((await firstWorker.POST(request.clone())).status).toBe(200);
    vi.resetModules();
    const secondWorker = await import("./route");
    expect((await secondWorker.POST(request)).status).toBe(401);
    expect(mocks.claim).toHaveBeenCalledTimes(2);
    expect(mocks.getStore).toHaveBeenCalledTimes(1);
    expect(mocks.load).toHaveBeenCalledTimes(1);
    expect(mocks.cas).not.toHaveBeenCalled();
  });

  it.each(["load", "compareAndSwap"] as const)("does not dispatch %s when claim is false", async operation => {
    mocks.claim.mockResolvedValueOnce(false);
    const { POST } = await import("./route");
    const value = operation === "load" ? { operation, accountId }
      : { operation, accountId, expectedRevision: 2, nextSnapshot: snapshot };
    expect((await POST(signed(value))).status).toBe(401);
    expect(mocks.getStore).not.toHaveBeenCalled(); expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.cas).not.toHaveBeenCalled();
  });

  it("sanitizes claim RPC failures as unavailable, without dispatch or fallback", async () => {
    mocks.claim.mockRejectedValueOnce(new Error("PRIVATE_NONCE_SQL"));
    const { POST } = await import("./route");
    const response = await POST(signed({ operation: "load", accountId }));
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("PRIVATE_NONCE_SQL");
    expect(mocks.getStore).not.toHaveBeenCalled(); expect(mocks.load).not.toHaveBeenCalled();
  });

  it("fails closed if an invalid claim response escapes the helper", async () => {
    mocks.claim.mockResolvedValueOnce(undefined);
    const { POST } = await import("./route");
    expect((await POST(signed({ operation: "load", accountId }))).status).toBe(503);
    expect(mocks.getStore).not.toHaveBeenCalled();
  });

  it("passes only MAC-validated lower-case nonce and integer timestamp to the shared gate", async () => {
    const { POST } = await import("./route");
    const request = signed({ operation: "load", accountId });
    const nonce = request.headers.get("x-aureon-office-gateway-nonce");
    const timestamp = Number(request.headers.get("x-aureon-office-gateway-timestamp"));
    expect((await POST(request)).status).toBe(200);
    expect(mocks.claim).toHaveBeenCalledExactlyOnceWith(accountId, nonce, timestamp);
    expect(nonce).toMatch(/^[0-9a-f]{32}$/); expect(Number.isSafeInteger(timestamp)).toBe(true);
  });

  it.each([
    { headers: { "x-aureon-office-gateway-signature": "0".repeat(64) } },
    { raw: "{" },
  ])("does not claim unauthenticated or invalid JSON requests", async options => {
    const { POST } = await import("./route");
    expect((await POST(signed({ operation: "load", accountId }, options))).status).toBe(options.raw ? 400 : 401);
    expect(mocks.claim).not.toHaveBeenCalled(); expect(mocks.getStore).not.toHaveBeenCalled();
  });

  it("does not claim an out-of-scope signed operation", async () => {
    const { POST } = await import("./route");
    expect((await POST(signed({ operation: "load", accountId: "33333333-3333-4333-8333-333333333333" }))).status).toBe(403);
    expect(mocks.claim).not.toHaveBeenCalled(); expect(mocks.getStore).not.toHaveBeenCalled();
  });

  it("never starts load/CAS after the HTTP deadline even when a delayed claim succeeds", async () => {
    vi.useFakeTimers();
    let resolveClaim!: (value: boolean) => void;
    mocks.claim.mockReturnValueOnce(new Promise<boolean>(resolve => { resolveClaim = resolve; }));
    const { POST } = await import("./route");
    const pending = POST(signed({ operation: "compareAndSwap", accountId, expectedRevision: 2, nextSnapshot: snapshot }));
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.claim).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(OFFICE_GATEWAY_LIMITS.timeoutMs);
    expect((await pending).status).toBe(503);
    resolveClaim(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.getStore).not.toHaveBeenCalled(); expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.cas).not.toHaveBeenCalled();
  });
});
