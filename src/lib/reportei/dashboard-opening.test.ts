import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildDashboardDoc, comparisonOf, dashboardOpeningPeriod } from "./dashboard-doc";
import { addWidgets, makeId } from "./doc";
import { catalogEntry } from "./doc-catalog";
import { buildRealDoc, unavailableWidget } from "./meta-doc";

const m = vi.hoisted(() => ({ collect: vi.fn(), from: vi.fn(), update: vi.fn(), row: {} as Record<string, unknown> }));
vi.mock("@/lib/auth/require-permission", () => ({ requirePermission: async () => ({ accountId: "company", supabase: { from: m.from } }) }));
vi.mock("@/lib/auth/account", () => ({ toErrorResponse: () => new Response("error", { status: 500 }) }));
vi.mock("@/lib/reportei/report-data", () => ({ collectAccountSnapshots: m.collect }));
import { GET, PATCH } from "../../app/api/operational/reportei/client-dashboards/[id]/route";

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
    m.update.mockReturnValue(chain);
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
  it("inserts a blank indicator and saves only the real values read for the displayed period", async () => {
    const period = dashboardOpeningPeriod();
    const insights = { spend: 100, impressions: 1000, clicks: 50, reach: 800, ctr: 5, cpc: 2, cpm: 100, conversations: 20 };
    const account = { id: "act_1", name: "Example", currency: "BRL", insights, previous: { ...insights, spend: 80, conversations: 10 } };
    const original = buildRealDoc({ layout: { custom: [], blocks: [{ network: "meta_ads", keys: ["spend"] }] }, accounts: [account], range: period, newId: makeId }).doc;
    m.row.doc = original;
    m.collect.mockResolvedValue([account]);
    const made = catalogEntry("meta_ads", "conversations")!.make({ id: "new", range: period, seed: "example" });
    const blank = unavailableWidget(made, "Aguardando leitura da Meta.");
    const next = addWidgets(original, original.blocks[0].id, [blank.kind === "metric" ? { ...blank, comparison: true } : blank]);
    const response = await PATCH(new Request(`http://localhost/api/operational/reportei/client-dashboards/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ doc: next, period, compare: true }) }), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.doc.blocks[0].widgets.find((w: { id: string }) => w.id === "new")).toMatchObject({ value: 20, previous: 10, comparison: true });
    expect(body.doc.blocks[0].widgets.find((w: { id: string }) => w.id === "new").unavailable).toBeUndefined();
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ doc: body.doc, period }));
  });
  it("opening an existing campaign table opts into the real breakdown without changing saved configuration", async () => {
    const period = dashboardOpeningPeriod();
    const account = { id: "act_1", name: "Example", currency: "BRL", insights: { spend: 100, impressions: 1000, clicks: 50, reach: 800, ctr: 5, cpc: 2, cpm: 100 } };
    const original = buildRealDoc({ layout: { custom: [], blocks: [{ network: "meta_ads", keys: ["campaigns"] }] }, accounts: [account], range: period, newId: makeId }).doc;
    m.row.doc = original;
    m.collect.mockResolvedValue([{ ...account, campaignTable: { readAt: "2026-11-09T15:00:00.000Z", rows: [{ id: "1", name: "Campaign", status: "ACTIVE", spend: 100, impressions: 1000, clicks: 50, leads: 0, conversations: 2, purchases: null }] } }]);
    const { dashboard } = await (await request()).json();
    expect(m.collect).toHaveBeenCalledWith(expect.anything(), "client", expect.objectContaining({ campaignTable: true, ...period }));
    expect(dashboard.doc.blocks[0].widgets[0]).toMatchObject({ rows: [expect.objectContaining({ campaign: "Campaign", spend: 100, status: "Ativa" })] });
    expect(dashboard.doc.blocks[0].widgets[0].unavailable).toBeUndefined();
    expect(m.update).not.toHaveBeenCalled();
  });
});
