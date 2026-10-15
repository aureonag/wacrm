import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ gate: vi.fn(), factory: vi.fn(), load: vi.fn() }));
vi.mock("@/lib/office/access", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/office/access")>(), getOfficeContext: mocks.gate,
}));
vi.mock("@/lib/office/runtime/avatar-server", () => ({ getOfficeAvatarComposer: mocks.factory }));
const { UnauthorizedError, ForbiddenError } = await import("@/lib/auth/account");
const { GET, HEAD } = await import("./route");
const context = { params: Promise.resolve({ kind: "essentials", recipe: "abc.png" }) };
beforeEach(() => {
  mocks.gate.mockResolvedValue({ user: { id: "current-member" } });
  mocks.factory.mockReturnValue({ load: mocks.load }); mocks.load.mockResolvedValue({ bytes: Buffer.from("png-fixture") });
});
afterEach(() => vi.clearAllMocks());
describe("avatar preview protected through the current CRM identity", () => {
  it("passes the fresh identity after membership succeeds", async () => {
    const response = await GET(new Request("https://crm.test/api/office/avatar-composition/essentials/abc.png"), context);
    expect(response.status).toBe(200);
    expect(mocks.factory).toHaveBeenCalledExactlyOnceWith({ user: { id: "current-member" } });
    expect(mocks.load).toHaveBeenCalledExactlyOnceWith("essentials", "abc");
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  });
  it.each([new UnauthorizedError(), new ForbiddenError()])("does not contact the image service for a rejected member", async error => {
    mocks.gate.mockRejectedValue(error);
    const response = await GET(new Request("https://crm.test/api/office/avatar-composition/essentials/abc.png"), context);
    expect([401, 403]).toContain(response.status); expect(mocks.factory).not.toHaveBeenCalled();
  });
  it("rejects an escaped recipe before any composition", async () => {
    const response = await GET(new Request("https://crm.test/api/office/avatar-composition/essentials/%61bc.png"), context);
    expect(response.status).toBe(400); expect(mocks.factory).not.toHaveBeenCalled();
  });
  it("does not return image bytes for HEAD", async () => {
    const response = await HEAD(new Request("https://crm.test/api/office/avatar-composition/essentials/abc.png", { method: "HEAD" }), context);
    expect(response.status).toBe(200); expect(await response.text()).toBe("");
  });
});
