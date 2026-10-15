import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ gate: vi.fn(), service: vi.fn(), request: vi.fn() }));
vi.mock("@/lib/office/access", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/office/access")>(), getOfficeContext: mocks.gate,
}));
vi.mock("@/lib/office/runtime/server", () => ({ getOfficeService: mocks.service }));
const { UnauthorizedError, ForbiddenError } = await import("@/lib/auth/account");
const { GET, POST } = await import("./route");

const identity = {
  user: { id: "auth-user", profileId: "profile", name: "Ana", avatarUrl: null },
  accountId: "aureon-account", role: "viewer",
  capabilities: { canDecorate: false, canManageMembers: false },
};
const context = { params: Promise.resolve({ endpoint: "message" }) };
function request(method = "POST", overrides: Record<string, string> = {}) {
  return new Request("https://crm.test/api/office/interface/message", {
    method,
    headers: {
      origin: "https://crm.test", "content-type": "application/json",
      "x-aureon-office-user": identity.user.id, "x-aureon-office-account": identity.accountId,
      ...overrides,
    },
    ...(method === "POST" ? { body: JSON.stringify({ text: "teste", userId: "forged", accountId: "forged", role: "owner" }) } : {}),
  });
}
beforeEach(() => {
  mocks.gate.mockResolvedValue(identity);
  mocks.service.mockReturnValue({ requestAsCrm: mocks.request });
  mocks.request.mockResolvedValue({ ok: true });
});
afterEach(() => vi.clearAllMocks());

describe("CRM office interface route", () => {
  it("takes identity only from the server gate", async () => {
    const response = await POST(request(), context);
    expect(response.status).toBe(200);
    expect(mocks.request.mock.calls[0][0]).toEqual(identity);
    expect(mocks.request.mock.calls[0][0].role).toBe("viewer");
    expect(mocks.request.mock.calls[0][1]).toBe("POST");
  });
  it.each([new UnauthorizedError(), new ForbiddenError()])("does not initialize admin state for a failed gate", async error => {
    mocks.gate.mockRejectedValue(error);
    const response = await GET(request("GET"), context);
    expect([401, 403]).toContain(response.status);
    expect(mocks.service).not.toHaveBeenCalled();
  });
  it("rejects requests from an iframe bound to a previous signed-in user", async () => {
    const response = await POST(request("POST", { "x-aureon-office-user": "previous-user" }), context);
    expect(response.status).toBe(403);
    expect(mocks.service).not.toHaveBeenCalled();
  });
  it("rejects requests without identity binding", async () => {
    const response = await GET(request("GET", { "x-aureon-office-account": "" }), context);
    expect(response.status).toBe(403);
    expect(mocks.service).not.toHaveBeenCalled();
  });
  it("rejects a cross-origin post before dispatch", async () => {
    const response = await POST(request("POST", { origin: "https://outside.test" }), context);
    expect(response.status).toBe(403);
    expect(mocks.request).not.toHaveBeenCalled();
  });
});
