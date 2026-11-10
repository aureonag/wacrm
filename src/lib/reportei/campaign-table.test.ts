import { describe, expect, it } from "vitest";
import { filterCampaignRows, needsCampaignTable } from "./campaign-table";
import { buildRealDoc, metaWidget, refreshRealDoc } from "./meta-doc";
import { parseDoc, widgetToCsv, type TableWidget } from "./doc";
import type { AccountSnapshot } from "./report";

const range = { since: "2026-10-01", until: "2026-10-31" };
const snapshot: AccountSnapshot = {
  id: "act_1", name: "Conta", currency: "USD",
  insights: { spend: 30, impressions: 100, clicks: 8, reach: 80, ctr: 8, cpc: 3.75, cpm: 300 },
  campaignTable: { readAt: "2026-11-10T13:00:00.000Z", rows: [
    { id: "1", name: "Ativa sem entrega", status: "ACTIVE", spend: 0, impressions: 0, clicks: 0, leads: 0, conversations: 0, purchases: null },
    { id: "2", name: "Pausada com entrega", status: "PAUSED", spend: 30, impressions: 100, clicks: 8, leads: 2, conversations: 3, purchases: 1 },
    { id: "3", name: "Histórica sem status", status: "", spend: 1, impressions: 5, clicks: 0, leads: null, conversations: null, purchases: null },
  ] },
};
const make = () => metaWidget("campaigns", snapshot, { id: "w", range }) as TableWidget;
describe("campaign table document", () => {
  it("shows real campaign data and currency, not the catalog's fictitious rows", () => {
    const w = make();
    expect(w).toMatchObject({ kind: "table", currency: "USD", campaignReadAt: snapshot.campaignTable!.readAt });
    expect(w.unavailable).toBeUndefined();
    expect(w.rows).toHaveLength(3);
    expect(w.rows[1]).toMatchObject({ campaign: "Pausada com entrega", status: "Pausada", spend: 30, leads: 2, conversations: 3, purchases: 1 });
    expect(w.rows[2]).toMatchObject({ status: "Status não disponível", leads: "—" });
  });
  it("active-now does not mean delivery-in-period and paused campaigns are not hidden from history", () => {
    const rows = make().rows;
    expect(filterCampaignRows(rows, "all")).toHaveLength(3);
    expect(filterCampaignRows(rows, "active").map((r) => r.campaign)).toEqual(["Ativa sem entrega"]);
    expect(filterCampaignRows(rows, "delivered").map((r) => r.campaign)).toEqual(["Pausada com entrega", "Histórica sem status"]);
    expect(rows).toHaveLength(3); // View filtering never mutates the saved snapshot.
  });
  it("an empty successful read stays an available, empty table", () => {
    const w = metaWidget("campaigns", { ...snapshot, campaignTable: { rows: [], readAt: snapshot.campaignTable!.readAt } }, { id: "w", range }) as TableWidget;
    expect(w.rows).toEqual([]);
    expect(w.unavailable).toBeUndefined();
  });
  it("a failed breakdown clears stale rows while valid account totals remain available", () => {
    const bad = { ...snapshot, campaignTable: undefined, campaignTableError: "Falha na coleta" };
    expect(metaWidget("campaigns", bad, { id: "w", range })).toMatchObject({ rows: [], unavailable: "Falha na coleta" });
    expect(metaWidget("spend", bad, { id: "m", range })).toMatchObject({ value: 30 });
  });
  it("refreshes existing tables and preserves titles, size, analysis, ids, sort and order", () => {
    const doc = buildRealDoc({ layout: { custom: [], blocks: [{ network: "meta_ads", keys: ["campaigns", "spend"] }] }, accounts: [snapshot], range, newId: (p) => p + Math.random() }).doc;
    const old = doc.blocks[0].widgets[0] as TableWidget;
    old.title = "Minhas campanhas"; old.size = "wide"; old.sortKey = "clicks";
    doc.blocks[0].analysis = "Preservar análise";
    const fresh = refreshRealDoc(doc, [{ ...snapshot, campaignTable: { ...snapshot.campaignTable!, rows: [snapshot.campaignTable!.rows[1]] } }], range).doc;
    expect(fresh.blocks[0]).toMatchObject({ analysis: "Preservar análise" });
    expect(fresh.blocks[0].widgets[0]).toMatchObject({ id: old.id, title: old.title, size: "wide", sortKey: "clicks", rows: [expect.objectContaining({ spend: 30 })] });
    expect(parseDoc(fresh)).not.toBeNull();
  });
  it("preserves document validation and exports real numbers without internal status fields", () => {
    const doc = buildRealDoc({ layout: { custom: [], blocks: [{ network: "meta_ads", keys: ["campaigns"] }] }, accounts: [snapshot], range, newId: (p) => p }).doc;
    expect(parseDoc(doc)).not.toBeNull();
    const csv = widgetToCsv(make());
    expect(csv).toContain("Gasto (USD)");
    expect(csv).toContain("Pausada com entrega;Pausada;30;100;8;2;3;1");
    expect(csv).not.toContain("_status");
    (doc.blocks[0].widgets[0] as TableWidget).campaignReadAt = "bad";
    expect(parseDoc(doc)).toBeNull();
  });
  it("only opts campaign documents/templates into the extra read", () => {
    expect(needsCampaignTable({ blocks: [{ network: "meta_ads", keys: ["spend"] }] })).toBe(false);
    expect(needsCampaignTable({ blocks: [{ network: "google_ads", keys: ["campaigns"] }] })).toBe(false);
    expect(needsCampaignTable({ blocks: [{ network: "meta_ads", widgets: [{ key: "campaigns" }] }] })).toBe(true);
    expect(needsCampaignTable({ blocks: [{ network: "meta_ads", keys: ["campaigns"] }] })).toBe(true);
  });
});
