import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  configured: false,
  connections: [] as { id: string; token: string; fbUserName: string | null; tokenExpiresAt: string | null }[],
  summaries: [] as { id: string; name: string | null; status: string }[],
  list: vi.fn(), refresh: vi.fn(), markFailed: vi.fn(),
}));
vi.mock("@/lib/auth/require-permission", () => ({ requirePermission: async () => ({ accountId: "company" }) }));
vi.mock("@/lib/auth/account", () => ({ toErrorResponse: () => new Response("error", { status: 500 }) }));
vi.mock("@/lib/reportei/meta-oauth", () => ({ isMetaLoginConfigured: () => m.configured }));
vi.mock("@/lib/reportei/meta-connection", () => ({
  listCompanyConnections: async () => m.connections,
  listCompanyConnectionSummaries: async () => m.summaries,
  refreshConnectionIfDue: m.refresh,
  markConnectionFailed: m.markFailed,
}));
vi.mock("@/lib/reportei/meta-ads", async (original) => ({
  ...await original<typeof import("./meta-ads")>(),
  listConnectionAdAccounts: m.list,
}));
import { GET } from "../../app/api/operational/reportei/meta/ad-accounts/route";
import { MetaAdsError } from "./meta-ads";

beforeEach(() => {
  vi.clearAllMocks();
  m.configured = false;
  m.connections = [{ id: "connection-a", token: "private-token", fbUserName: "Ana", tokenExpiresAt: null }];
  m.summaries = [{ id: "connection-a", name: "Ana", status: "connected" }];
  m.refresh.mockImplementation(async (c) => c);
  m.list.mockResolvedValue([{ id: "act_123", name: "Aureon", currency: "BRL", timezone: "America/Sao_Paulo", status: 1 }]);
});

describe("Meta picker: existing reads and new authorization are independent", () => {
  it("lists already authorized accounts even when new sign-in is not configured, without trying to renew", async () => {
    const response = await GET(new Request("http://localhost/api/operational/reportei/meta/ad-accounts"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ configured: false, oauthConfigured: false, connected: true, accounts: [{ id: "act_123", connectionId: "connection-a" }] });
    expect(m.refresh).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain("private-token");
  });
  it("keeps a broken identity visible for an explicit reconnection, without exposing its credential", async () => {
    m.connections = [];
    m.configured = true;
    m.summaries[0].status = "revoked";
    const body = await (await GET(new Request("http://localhost/api/operational/reportei/meta/ad-accounts"))).json();
    expect(body).toMatchObject({ oauthConfigured: true, connected: false, connections: [{ id: "connection-a", status: "revoked" }] });
    expect(m.list).not.toHaveBeenCalled();
  });
  it("does not pretend a missing app is configured when no saved connection exists", async () => {
    m.connections = [];
    m.summaries = [];
    const body = await (await GET(new Request("http://localhost/api/operational/reportei/meta/ad-accounts"))).json();
    expect(body).toMatchObject({ configured: false, oauthConfigured: false, connected: false });
  });
  it("renews only with the app configuration present", async () => {
    m.configured = true;
    await GET(new Request("http://localhost/api/operational/reportei/meta/ad-accounts"));
    expect(m.refresh).toHaveBeenCalledWith(m.connections[0]);
  });
  it("preserves accounts from a healthy connection when another login expired", async () => {
    m.configured = true;
    m.connections.push({ id: "connection-b", token: "expired-private", fbUserName: "Beto", tokenExpiresAt: null });
    m.summaries.push({ id: "connection-b", name: "Beto", status: "connected" });
    m.list.mockRejectedValueOnce(new MetaAdsError("expired", "token_invalid")).mockResolvedValueOnce([{ id: "act_2", name: "B", currency: "BRL", timezone: null, status: 1 }]);
    const response = await GET(new Request("http://localhost/api/operational/reportei/meta/ad-accounts"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.accounts).toEqual([expect.objectContaining({ id: "act_2", connectionId: "connection-b" })]);
    expect(m.markFailed).toHaveBeenCalledWith("connection-a", "revoked", "expired");
    expect(JSON.stringify(body)).not.toContain("private-token");
  });
});
