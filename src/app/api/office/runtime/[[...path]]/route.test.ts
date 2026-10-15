import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ gate: vi.fn(), factory: vi.fn(), load: vi.fn() }));
vi.mock("@/lib/office/access", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/office/access")>(), getOfficeContext: mocks.gate,
}));
vi.mock("@/lib/office/runtime/asset-server", () => ({ getOfficeAssets: mocks.factory }));
const { UnauthorizedError, ForbiddenError } = await import("@/lib/auth/account");
const { OfficeAssetError } = await import("@/lib/office/runtime/assets");
const { GET, HEAD } = await import("./route");

beforeEach(() => {
  mocks.gate.mockResolvedValue({ user: { id: "member" } });
  mocks.factory.mockReturnValue({ load: mocks.load });
  mocks.load.mockResolvedValue({ bytes: Buffer.from("office"), contentType: "text/html; charset=utf-8", size: 6, etag: '"hash"' });
});
afterEach(() => vi.clearAllMocks());

describe("private office runtime route", () => {
  it("authenticates before resolving the asset and defaults to index", async () => {
    const response = await GET(new Request("https://crm.test/api/office/runtime/"));
    expect(mocks.gate).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.factory).toHaveBeenCalledExactlyOnceWith({ user: { id: "member" } });
    expect(mocks.load).toHaveBeenCalledExactlyOnceWith("index.html");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("office");
    expect(response.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  });
  it("passes percent escapes unchanged to the strict loader", async () => {
    await GET(new Request("https://crm.test/api/office/runtime/assets/%2eenv"));
    expect(mocks.load).toHaveBeenCalledExactlyOnceWith("assets/%2eenv");
  });
  it.each([new UnauthorizedError(), new ForbiddenError()])("never loads files after a rejected membership check", async error => {
    mocks.gate.mockRejectedValue(error);
    const response = await GET(new Request("https://crm.test/api/office/runtime/app.js"));
    expect([401, 403]).toContain(response.status);
    expect(mocks.factory).not.toHaveBeenCalled();
  });
  it("answers HEAD without file contents", async () => {
    const response = await HEAD(new Request("https://crm.test/api/office/runtime/style.css", { method: "HEAD" }));
    expect(response.headers.get("content-length")).toBe("6");
    expect(await response.text()).toBe("");
  });
  it.each([404, 503] as const)("hides file paths on asset error %s", async status => {
    mocks.load.mockRejectedValue(new OfficeAssetError(status));
    const response = await GET(new Request("https://crm.test/api/office/runtime/.env"));
    expect(response.status).toBe(status);
    expect(JSON.stringify(await response.json())).not.toContain("E:");
  });
});
