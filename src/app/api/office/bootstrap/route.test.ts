import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ gate: vi.fn(), factory: vi.fn(), request: vi.fn() }));
vi.mock("@/lib/office/access", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/office/access")>(), getOfficeContext: mocks.gate,
}));
vi.mock("@/lib/office/runtime/server", () => ({ getOfficeService: mocks.factory }));
const { UnauthorizedError, ForbiddenError } = await import("@/lib/auth/account");
const { GET } = await import("./route");
const identity = {
  user: { id: "auth-user", profileId: "profile", name: "Ana", avatarUrl: null },
  accountId: "aureon-account", role: "viewer",
  capabilities: { canDecorate: false, canManageMembers: false },
};
beforeEach(() => {
  mocks.gate.mockResolvedValue(identity);
  mocks.factory.mockReturnValue({ requestAsCrm: mocks.request });
  mocks.request.mockResolvedValue({
    map: { objects: [], floor: "#a27f6b", construction: [] },
    clientState: { "aureon-avatar-v1": "{}" },
    users: [{ id: "other", clientState: { private: "must not escape" } }],
    snapshot: { messages: ["private DM"] },
  });
});
afterEach(() => vi.clearAllMocks());

describe("office bootstrap route", () => {
  it("returns only authenticated identity, shared map and own client preferences", async () => {
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(["clientState", "identity", "map"]);
    expect(body.identity).toEqual(identity);
    expect(mocks.request).toHaveBeenCalledWith(identity, "GET", "/bootstrap");
    expect(JSON.stringify(body)).not.toContain("private DM");
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  });
  it.each([new UnauthorizedError(), new ForbiddenError()])("never opens the backend for a rejected session", async error => {
    mocks.gate.mockRejectedValue(error);
    const response = await GET();
    expect([401, 403]).toContain(response.status);
    expect(mocks.factory).not.toHaveBeenCalled();
  });
});
