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
afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); });

function timings(response: Response) {
  const header = response.headers.get("server-timing");
  // Only fixed metric names and bounded decimal durations are permitted. This
  // rejects descriptions, identifiers, paths, request headers and error text.
  expect(header).toMatch(/^office_auth;dur=\d{1,7}\.\d(?:, office_asset;dur=\d{1,7}\.\d)?, office_route;dur=\d{1,7}\.\d$/);
  return Object.fromEntries(header!.split(", ").map(metric => {
    const [name, value] = metric.split(";dur=");
    const duration = Number(value);
    expect(Number.isFinite(duration)).toBe(true);
    expect(duration).toBeGreaterThanOrEqual(0);
    expect(duration).toBeLessThanOrEqual(3_600_000);
    return [name, duration];
  }));
}

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

  it("measures asynchronous authorization and asset loading independently without changing the successful response", async () => {
    let clock = 100;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    mocks.gate.mockImplementation(async () => { await Promise.resolve(); clock += 12.5; return { user: { id: "member" } }; });
    mocks.load.mockImplementation(async () => {
      await Promise.resolve(); clock += 7.5;
      return { bytes: Buffer.from("office"), contentType: "text/html; charset=utf-8", size: 6, etag: '"hash"' };
    });
    const response = await GET(new Request("https://crm.test/api/office/runtime/index.html"));
    expect(timings(response)).toEqual({ office_auth: 12.5, office_asset: 7.5, office_route: 20 });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("office");
    expect(Object.fromEntries([...response.headers].filter(([key]) => key !== "server-timing"))).toEqual({
      "cache-control": "private, no-store, max-age=0", "content-type": "text/html; charset=utf-8",
      "content-length": "6", etag: '"hash"', vary: "Cookie", "x-content-type-options": "nosniff", "x-frame-options": "SAMEORIGIN",
    });
  });

  it.each([new UnauthorizedError(), new ForbiddenError()])("times rejected authorization without invoking or reporting an asset load", async error => {
    let clock = 10;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    mocks.gate.mockImplementation(async () => { clock += 25; throw error; });
    const response = await GET(new Request("https://crm.test/api/office/runtime/app.js"));
    expect(timings(response)).toEqual({ office_auth: 25, office_route: 25 });
    expect(response.status).toBe(error instanceof UnauthorizedError ? 401 : 403);
    expect(mocks.factory).not.toHaveBeenCalled(); expect(mocks.load).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("vary")).toBe("Cookie");
  });

  it.each([404, 503] as const)("measures failed asset lookup %s and preserves its sanitized response", async status => {
    let clock = 100;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    mocks.load.mockImplementation(async () => { clock += 40; throw new OfficeAssetError(status); });
    const response = await GET(new Request("https://crm.test/api/office/runtime/assets/missing.png"));
    expect(timings(response)).toEqual({ office_auth: 0, office_asset: 40, office_route: 40 });
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: status === 404 ? "Arquivo não encontrado." : "O escritório está indisponível." });
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("keeps HEAD bodyless with the same asset headers and the same measured stages", async () => {
    let clock = 10;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    mocks.load.mockImplementation(async () => {
      clock += 18;
      return { bytes: Buffer.from("office"), contentType: "text/css; charset=utf-8", size: 6, etag: '"head-hash"' };
    });
    const response = await HEAD(new Request("https://crm.test/api/office/runtime/style.css", { method: "HEAD" }));
    expect(timings(response)).toEqual({ office_auth: 0, office_asset: 18, office_route: 18 });
    expect(response.status).toBe(200); expect(await response.text()).toBe("");
    expect(response.headers.get("content-length")).toBe("6");
    expect(response.headers.get("content-type")).toBe("text/css; charset=utf-8");
    expect(response.headers.get("etag")).toBe('"head-hash"');
    expect(response.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  });

  it("does not include identity, cookies, authorization, request query or exception details in timings", async () => {
    mocks.gate.mockResolvedValue({ user: { id: "PRIVATE_MEMBER_ID", name: "PRIVATE_MEMBER_NAME" }, accountId: "PRIVATE_ACCOUNT" });
    mocks.load.mockRejectedValue(new Error("PRIVATE_EXCEPTION /srv/private/file"));
    const response = await GET(new Request("https://crm.test/api/office/runtime/app.js?secret=PRIVATE_QUERY", {
      headers: { cookie: "session=PRIVATE_COOKIE", authorization: "Bearer PRIVATE_AUTH" },
    }));
    expect(response.status).toBe(500);
    timings(response);
    expect(response.headers.get("server-timing")).not.toMatch(/PRIVATE|exception|member|account|cookie|auth=|\/srv|secret/i);
    expect(response.headers.has("timing-allow-origin")).toBe(false);
    expect(await response.json()).toEqual({ error: "Não foi possível carregar o escritório." });
  });

  it("measures a synchronous loader factory failure without bypassing authorization", async () => {
    mocks.factory.mockImplementation(() => { throw new Error("PRIVATE_FACTORY_ERROR"); });
    const response = await GET(new Request("https://crm.test/api/office/runtime/index.html"));
    expect(response.status).toBe(500);
    expect(Object.keys(timings(response))).toEqual(["office_auth", "office_asset", "office_route"]);
    expect(mocks.gate).toHaveBeenCalledOnce(); expect(mocks.load).not.toHaveBeenCalled();
  });

  it.each([NaN, Infinity, -Infinity])("keeps metrics finite when the clock is invalid (%s)", async invalid => {
    vi.spyOn(performance, "now").mockReturnValue(invalid);
    const response = await GET(new Request("https://crm.test/api/office/runtime/"));
    expect(response.status).toBe(200);
    expect(timings(response)).toEqual({ office_auth: 0, office_asset: 0, office_route: 0 });
  });

  it("bounds backwards or excessive elapsed values without altering asset delivery", async () => {
    let clock = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    mocks.gate.mockImplementation(async () => { clock = 900; return { user: { id: "member" } }; });
    mocks.load.mockImplementation(async () => {
      clock = 4_000_000;
      return { bytes: Buffer.from("office"), contentType: "text/html; charset=utf-8", size: 6, etag: '"hash"' };
    });
    const response = await GET(new Request("https://crm.test/api/office/runtime/"));
    expect(timings(response)).toEqual({ office_auth: 0, office_asset: 3_600_000, office_route: 3_600_000 });
    expect(await response.text()).toBe("office");
  });
});
