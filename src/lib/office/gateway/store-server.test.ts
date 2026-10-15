import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUREON_ACCOUNT_ID } from "../runtime/store";

const createClient = vi.hoisted(() => vi.fn());
vi.mock("@supabase/supabase-js", () => ({ createClient }));
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  vi.stubEnv("AUREON_OFFICE_ENABLED", "true");
  vi.stubEnv("AUREON_OFFICE_TRANSPORT", "gateway");
  vi.stubEnv("AUREON_OFFICE_ACCOUNT_ID", AUREON_ACCOUNT_ID);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://fixture.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "fixture-server-key");
});
afterEach(() => vi.unstubAllEnvs());

describe("CRM-only lazy gateway storage", () => {
  it.each([
    ["AUREON_OFFICE_ENABLED", undefined], ["AUREON_OFFICE_ENABLED", "false"],
    ["AUREON_OFFICE_TRANSPORT", undefined], ["AUREON_OFFICE_TRANSPORT", "local"],
    ["AUREON_OFFICE_ACCOUNT_ID", undefined], ["AUREON_OFFICE_ACCOUNT_ID", "11111111-1111-4111-8111-111111111111"],
  ])("fails closed for disabled or mismatched config %s/%s", async (name, value) => {
    vi.stubEnv(name!, value);
    const { getOfficeBackendStore, requireOfficeBackendStoreScope } = await import("./store-server");
    expect(() => requireOfficeBackendStoreScope()).toThrowError(/unavailable/);
    expect(() => getOfficeBackendStore()).toThrowError(/unavailable/);
    expect(createClient).not.toHaveBeenCalled();
  });
  it("does not construct a Supabase client just to check scope", async () => {
    const { requireOfficeBackendStoreScope } = await import("./store-server");
    expect(requireOfficeBackendStoreScope()).toBe(AUREON_ACCOUNT_ID);
    expect(createClient).not.toHaveBeenCalled();
  });
  it.each(["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"])("requires server-only credential %s lazily", async name => {
    vi.stubEnv(name, undefined);
    const { getOfficeBackendStore } = await import("./store-server");
    expect(() => getOfficeBackendStore()).toThrowError(/unavailable/);
    expect(createClient).not.toHaveBeenCalled();
  });
  it("constructs one non-session Supabase store and exposes only the scoped store interface", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { revision: 0, snapshot: null }, error: null });
    createClient.mockReturnValue({ rpc });
    const { getOfficeBackendStore } = await import("./store-server");
    const first = getOfficeBackendStore();
    expect(getOfficeBackendStore()).toBe(first);
    expect(createClient).toHaveBeenCalledExactlyOnceWith("https://fixture.supabase.co", "fixture-server-key", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    expect(await first.load(AUREON_ACCOUNT_ID)).toEqual({ revision: 0, snapshot: null });
    expect(Object.keys(first).sort()).toEqual(["compareAndSwap", "load"]);
    vi.stubEnv("AUREON_OFFICE_TRANSPORT", "local");
    expect(() => getOfficeBackendStore()).toThrowError(/unavailable/);
  });
});


describe("durable callback nonce claim", () => {
  const nonce = "ab".repeat(16), issuedAt = 1_792_080_000_000;

  it.each([true, false])("returns only the RPC boolean %s and shares the lazy server client with the store", async committed => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: committed, error: null })
      .mockResolvedValueOnce({ data: { revision: 0, snapshot: null }, error: null });
    createClient.mockReturnValue({ rpc });
    const { claimOfficeBackendNonce, getOfficeBackendStore } = await import("./store-server");
    expect(await claimOfficeBackendNonce(AUREON_ACCOUNT_ID, nonce, issuedAt)).toBe(committed);
    expect(rpc).toHaveBeenNthCalledWith(1, "office_gateway_claim_nonce", {
      p_account_id: AUREON_ACCOUNT_ID, p_nonce: nonce, p_issued_at_ms: issuedAt,
    });
    expect(await getOfficeBackendStore().load(AUREON_ACCOUNT_ID)).toEqual({ revision: 0, snapshot: null });
    expect(createClient).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["33333333-3333-4333-8333-333333333333", nonce, issuedAt],
    [AUREON_ACCOUNT_ID, "AB".repeat(16), issuedAt],
    [AUREON_ACCOUNT_ID, "a".repeat(31), issuedAt],
    [AUREON_ACCOUNT_ID, nonce, -1],
    [AUREON_ACCOUNT_ID, nonce, 1.5],
    [AUREON_ACCOUNT_ID, nonce, Number.MAX_SAFE_INTEGER + 1],
    [AUREON_ACCOUNT_ID, nonce, NaN],
  ])("rejects invalid claim input without constructing a service client", async (accountId, value, timestamp) => {
    const { claimOfficeBackendNonce } = await import("./store-server");
    await expect(claimOfficeBackendNonce(accountId as string, value as string, timestamp as number))
      .rejects.toMatchObject({ status: 503, code: "OFFICE_STORAGE_UNAVAILABLE" });
    expect(createClient).not.toHaveBeenCalled();
  });

  it.each([
    undefined, null, { data: null, error: null }, { data: "true", error: null },
    { data: [], error: null }, { data: true, error: { message: "PRIVATE_SQL" } },
  ])("fails closed for missing, invalid or failed claim RPC responses", async response => {
    createClient.mockReturnValue({ rpc: vi.fn().mockResolvedValue(response) });
    const { claimOfficeBackendNonce } = await import("./store-server");
    await expect(claimOfficeBackendNonce(AUREON_ACCOUNT_ID, nonce, issuedAt))
      .rejects.toMatchObject({ status: 503, message: "Office storage is unavailable" });
  });

  it("sanitizes thrown RPC errors without retry or memory fallback", async () => {
    const rpc = vi.fn().mockRejectedValue(new Error("PRIVATE_SQL_KEY"));
    createClient.mockReturnValue({ rpc });
    const { claimOfficeBackendNonce } = await import("./store-server");
    await expect(claimOfficeBackendNonce(AUREON_ACCOUNT_ID, nonce, issuedAt))
      .rejects.toMatchObject({ status: 503, message: "Office storage is unavailable" });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("rechecks the feature/transport/account gate before every claim", async () => {
    const { claimOfficeBackendNonce } = await import("./store-server");
    vi.stubEnv("AUREON_OFFICE_TRANSPORT", "local");
    await expect(claimOfficeBackendNonce(AUREON_ACCOUNT_ID, nonce, issuedAt)).rejects.toMatchObject({ status: 503 });
    expect(createClient).not.toHaveBeenCalled();
  });

  it.each(["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"])("does not claim without %s", async name => {
    vi.stubEnv(name, undefined);
    const { claimOfficeBackendNonce } = await import("./store-server");
    await expect(claimOfficeBackendNonce(AUREON_ACCOUNT_ID, nonce, issuedAt)).rejects.toMatchObject({ status: 503 });
    expect(createClient).not.toHaveBeenCalled();
  });
});
