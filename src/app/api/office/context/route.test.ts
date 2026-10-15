import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getOfficeContext = vi.hoisted(() => vi.fn());
vi.mock("@/lib/office/access", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/office/access")>(),
  getOfficeContext,
}));

const { ForbiddenError, UnauthorizedError } = await import("@/lib/auth/account");
const { OfficeConfigurationError } = await import("@/lib/office/access");
const { GET, dynamic } = await import("./route");

const context = {
  user: { id: "verified-user", profileId: "verified-profile", name: "Ana", avatarUrl: null },
  accountId: "11111111-1111-4111-8111-111111111111",
  role: "viewer",
  capabilities: { canDecorate: false, canManageMembers: false },
};

beforeEach(() => {
  vi.stubEnv("AUREON_OFFICE_ENABLED", "true");
  getOfficeContext.mockResolvedValue(context);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function expectPrivate(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  expect(response.headers.get("vary")).toBe("Cookie");
}

describe("GET /api/office/context", () => {
  it.each([undefined, "", "false", "TRUE", "1"])("reports explicit feature rollback unless the flag is exactly true (%s)", async flag => {
    vi.stubEnv("AUREON_OFFICE_ENABLED", flag);
    const response = await GET();
    expect(getOfficeContext).toHaveBeenCalledExactlyOnceWith();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "O escritório está indisponível.", code: "OFFICE_FEATURE_DISABLED" });
    expectPrivate(response);
  });

  it.each([
    [new UnauthorizedError("private session"), 401, "Unauthorized"],
    [new ForbiddenError("private membership"), 403, "Office access is restricted"],
    [new OfficeConfigurationError(), 503, "Office is not configured"],
  ])("checks current access before revealing a disabled feature (%s)", async (error, status, message) => {
    vi.stubEnv("AUREON_OFFICE_ENABLED", "false");
    getOfficeContext.mockRejectedValue(error);
    const response = await GET();
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: message });
    expectPrivate(response);
  });

  it("returns the server context without allowing the route to be statically cached", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(context);
    expectPrivate(response);
    expect(dynamic).toBe("force-dynamic");
  });

  it("ignores identity, account and capability claims from the request", async () => {
    const forged = new Request(
      "https://crm.example.test/api/office/context?accountId=another-account&userId=forged&role=owner&canDecorate=true",
      {
        headers: {
          "x-account-id": "another-account",
          "x-user-id": "forged",
          "x-account-role": "owner",
          "x-office-can-decorate": "true",
        },
      },
    );
    // Next supplies a request argument even though this GET needs none of it.
    const response = await Reflect.apply(GET, undefined, [forged]);
    expect(getOfficeContext).toHaveBeenCalledExactlyOnceWith();
    expect(await response.json()).toEqual(context);
    expectPrivate(response);
  });

  it.each([
    [new UnauthorizedError("private session detail"), 401, "Unauthorized"],
    [new ForbiddenError("private membership detail"), 403, "Office access is restricted"],
    [new OfficeConfigurationError(), 503, "Office is not configured"],
  ])("returns a private classified error (%s)", async (error, status, message) => {
    getOfficeContext.mockRejectedValue(error);
    const response = await GET();
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: message });
    expectPrivate(response);
  });

  it("returns only a generic private 500 for unexpected failures", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    getOfficeContext.mockRejectedValue(new Error("secret database/schema/token detail"));
    const response = await GET();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Internal server error" });
    expectPrivate(response);
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret database");
  });
});
