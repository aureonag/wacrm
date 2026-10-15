import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OfficeContext } from "../access";

const mocks = vi.hoisted(() => ({
  client: vi.fn(), bootstrap: vi.fn(), request: vi.fn(), asset: vi.fn(), avatar: vi.fn(),
  supabase: vi.fn(), local: vi.fn(), store: vi.fn(), loader: vi.fn(), composer: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.supabase }));
vi.mock("../gateway/client", () => ({ createOfficeGatewayClient: mocks.client }));
vi.mock("./service.cjs", () => ({ createCrmInterfaceService: mocks.local }));
vi.mock("./store", () => ({ createSupabaseOfficeStore: mocks.store }));
vi.mock("./assets", () => ({ createOfficeAssetLoader: mocks.loader }));
vi.mock("./avatar-composition", () => ({ createOfficeAvatarComposer: mocks.composer }));
const identity = (name: string): OfficeContext => ({
  user: { id: name, profileId: name + "-profile", name, avatarUrl: null },
  accountId: "737433a3-ec29-4e90-b4ba-9989192ca735", role: "agent",
  capabilities: { canDecorate: false, canManageMembers: false },
});
beforeEach(() => {
  vi.resetModules(); vi.resetAllMocks();
  vi.stubEnv("AUREON_OFFICE_ENABLED", "true");
  vi.stubEnv("AUREON_OFFICE_TRANSPORT", "gateway");
  vi.stubEnv("AUREON_OFFICE_GATEWAY_URL", "https://office.invalid");
  vi.stubEnv("AUREON_OFFICE_GATEWAY_KEY", "ab".repeat(32));
  mocks.client.mockReturnValue({ bootstrap: mocks.bootstrap, interface: mocks.request, asset: mocks.asset, avatar: mocks.avatar });
  mocks.bootstrap.mockResolvedValue({ map: { objects: [], floor: "#fff" }, clientState: {} });
  mocks.request.mockResolvedValue({ ok: true });
  mocks.asset.mockResolvedValue({ bytes: Buffer.from("asset") });
  mocks.avatar.mockResolvedValue({ bytes: Buffer.from("avatar") });
});
afterEach(() => vi.unstubAllEnvs());

describe("explicit office transport at the authenticated server boundary", () => {
  it.each([undefined, "", "automatic", "LOCAL"])("never infers a deployment transport (%s)", async transport => {
    vi.stubEnv("AUREON_OFFICE_TRANSPORT", transport);
    const { getOfficeService } = await import("./server");
    expect(() => getOfficeService()).toThrowError("Office is not configured");
    expect(mocks.client).not.toHaveBeenCalled(); expect(mocks.supabase).not.toHaveBeenCalled();
  });
  it("checks the flag even after a transport was initialized", async () => {
    const { getOfficeService } = await import("./server");
    getOfficeService(); vi.stubEnv("AUREON_OFFICE_ENABLED", "false");
    expect(() => getOfficeService()).toThrowError("Office is not configured");
    expect(mocks.client).toHaveBeenCalledTimes(1);
  });
  it.each([undefined, "", "short", "z".repeat(64)])("rejects a missing or malformed gateway key without local fallback (%s)", async key => {
    vi.stubEnv("AUREON_OFFICE_GATEWAY_KEY", key);
    const { getOfficeService } = await import("./server");
    expect(() => getOfficeService()).toThrowError("Office is not configured");
    expect(mocks.client).not.toHaveBeenCalled(); expect(mocks.supabase).not.toHaveBeenCalled();
  });
  it("does not construct a gateway for a missing URL", async () => {
    vi.stubEnv("AUREON_OFFICE_GATEWAY_URL", undefined);
    const { getOfficeService } = await import("./server");
    expect(() => getOfficeService()).toThrow(); expect(mocks.supabase).not.toHaveBeenCalled();
  });
  it("keeps identities per request and never forwards user data as configuration", async () => {
    const { getOfficeService } = await import("./server");
    const service = getOfficeService(); const ana = identity("Ana"), bruno = identity("Bruno");
    await service.requestAsCrm(ana, "GET", "/bootstrap");
    await service.requestAsCrm(bruno, "POST", "/message", { text: "Teste", userId: "forged" }, {});
    expect(mocks.bootstrap).toHaveBeenCalledExactlyOnceWith(ana);
    expect(mocks.request).toHaveBeenCalledExactlyOnceWith(bruno, "POST", "message", { text: "Teste", userId: "forged" }, {});
    expect(mocks.client).toHaveBeenCalledExactlyOnceWith({ url: "https://office.invalid", key: Buffer.from("ab".repeat(32), "hex") });
    expect(mocks.supabase).not.toHaveBeenCalled(); expect(mocks.local).not.toHaveBeenCalled();
  });
  it.each(["state", "//state", "/state?user=forged", "/../state", "/state/other"])("rejects a noncanonical interface path %s", async pathname => {
    const { getOfficeService } = await import("./server");
    await expect(getOfficeService().requestAsCrm(identity("Ana"), "GET", pathname)).rejects.toThrow();
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("propagates gateway failures without constructing an independent local office", async () => {
    const failure = Object.assign(new Error("unavailable"), { status: 503 }); mocks.request.mockRejectedValue(failure);
    const { getOfficeService } = await import("./server");
    await expect(getOfficeService().requestAsCrm(identity("Ana"), "GET", "/state")).rejects.toBe(failure);
    expect(mocks.supabase).not.toHaveBeenCalled(); expect(mocks.local).not.toHaveBeenCalled();
  });
  it("requires current identity for remote assets and avatars", async () => {
    const { getOfficeAssets } = await import("./asset-server");
    const { getOfficeAvatarComposer } = await import("./avatar-server");
    expect(() => getOfficeAssets()).toThrow(); expect(() => getOfficeAvatarComposer()).toThrow();
    const ana = identity("Ana"), bruno = identity("Bruno");
    await getOfficeAssets(ana).load("index.html"); await getOfficeAssets(bruno).load("app.js");
    await getOfficeAvatarComposer(ana).load("essentials", "abc");
    await getOfficeAvatarComposer(bruno).load("extras", "def");
    expect(mocks.asset.mock.calls).toEqual([[ana, "index.html"], [bruno, "app.js"]]);
    expect(mocks.avatar.mock.calls).toEqual([[ana, "essentials", "abc"], [bruno, "extras", "def"]]);
    expect(mocks.loader).not.toHaveBeenCalled(); expect(mocks.composer).not.toHaveBeenCalled();
  });
  it("rebuilds a client after configuration changes without retaining an old identity", async () => {
    const { getOfficeGatewayClient } = await import("./transport");
    getOfficeGatewayClient(); getOfficeGatewayClient(); expect(mocks.client).toHaveBeenCalledTimes(1);
    vi.stubEnv("AUREON_OFFICE_GATEWAY_KEY", "cd".repeat(32)); getOfficeGatewayClient();
    expect(mocks.client).toHaveBeenCalledTimes(2);
  });
  it("initializes local database state only for an explicitly selected local transport", async () => {
    vi.stubEnv("AUREON_OFFICE_TRANSPORT", "local"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://test.invalid");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "fictitious-unit-test-key");
    const local = { requestAsCrm: vi.fn() }; mocks.local.mockReturnValue(local); mocks.supabase.mockReturnValue({});
    const { getOfficeService } = await import("./server");
    expect(getOfficeService()).toBe(local); expect(getOfficeService()).toBe(local);
    expect(mocks.supabase).toHaveBeenCalledTimes(1); expect(mocks.local).toHaveBeenCalledTimes(1);
    expect(mocks.client).not.toHaveBeenCalled();
  });
});
