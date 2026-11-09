import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildDashboardDoc, comparisonOf, dashboardOpeningPeriod } from "./dashboard-doc";

const m = vi.hoisted(() => ({ collect: vi.fn(), from: vi.fn(), update: vi.fn(), row: {} as Record<string, unknown> }));
vi.mock("@/lib/auth/require-permission", () => ({ requirePermission: async () => ({ accountId: "company", supabase: { from: m.from } }) }));
vi.mock("@/lib/auth/account", () => ({ toErrorResponse: () => new Response("error", { status: 500 }) }));
vi.mock("@/lib/reportei/report-data", () => ({ collectAccountSnapshots: m.collect }));
import { GET } from "../../app/api/operational/reportei/client-dashboards/[id]/route";

const id = "854ac75d-5a5a-4a52-a645-d0b5953d7318";
const request = () => GET(new Request(`http://localhost/api/operational/reportei/client-dashboards/${id}`), { params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-09T15:00:00Z"));
  vi.clearAllMocks();
  const doc = buildDashboardDoc([{ network: "meta_ads", account: "Example" }], { since: "2026-09-01", until: "2026-09-30" }, "example");
  m.row = { id, client_id: "client", title: "Example", doc: { ...doc, demo: true }, period: { preset: "custom", since: "2026-09-01", until: "2026-09-30" }, compare: false, ops_clients: { name: "Example" } };
  m.from.mockImplementation((table: string) => {
    const chain = { select: () => chain, eq: () => chain, update: m.update, maybeSingle: async () => ({ data: table === "reportei_dashboards" ? m.row : null, error: null }) };
    return chain;
  });
  m.collect.mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());

describe("dashboard opening", () => {
  it("advances each day, resets at the month boundary and uses São Paulo's day", () => {
    expect(dashboardOpeningPeriod()).toEqual({ preset: "this_month", since: "2026-11-01", until: "2026-11-09" });
    expect(dashboardOpeningPeriod(new Date("2026-11-10T15:00:00Z")).until).toBe("2026-11-10");
    expect(dashboardOpeningPeriod(new Date("2026-12-01T01:00:00Z")).until).toBe("2026-11-30");
    expect(dashboardOpeningPeriod(new Date("2026-12-01T03:00:00Z"))).toEqual({ preset: "this_month", since: "2026-12-01", until: "2026-12-01" });
    expect(comparisonOf(dashboardOpeningPeriod())).toEqual({ since: "2026-10-23", until: "2026-10-31" });
  });
  it("opens an existing custom dashboard in the current month with comparison without writing", async () => {
    const response = await request();
    expect(response.status).toBe(200);
    const { dashboard } = await response.json();
    expect(dashboard.period).toEqual(dashboardOpeningPeriod());
    expect(dashboard.compare).toBe(true);
    expect(m.update).not.toHaveBeenCalled();
    expect(m.collect).not.toHaveBeenCalled(); // Demo stays isolated from real accounts.
  });
  it("reads real figures for exactly the displayed dates and clears stale figures without a source", async () => {
    (m.row.doc as { demo: boolean }).demo = false;
    const { dashboard } = await (await request()).json();
    expect(m.collect).toHaveBeenCalledWith(expect.anything(), "client", { ...dashboardOpeningPeriod(), compare: comparisonOf(dashboardOpeningPeriod()), daily: true });
    expect(dashboard.doc).not.toEqual(m.row.doc);
    expect(m.update).not.toHaveBeenCalled();
  });
  it("does not return an old snapshot labeled as current when Meta cannot be read", async () => {
    (m.row.doc as { demo: boolean }).demo = false;
    m.collect.mockResolvedValue([{ insights: null }]);
    const response = await request();
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "unreadable" });
    expect(m.update).not.toHaveBeenCalled();
  });
});
