import { describe, expect, it } from "vitest";
import { addWidgets, deleteWidget, makeId, parseDoc, toggleHighlight, updateBlock, updateWidget, type Block, type MetricWidget, type ReportDoc, type Widget } from "./doc";
import { refreshDashboardDoc } from "./dashboard-doc";
import { demoSource } from "./doc-catalog";
import { DASHBOARD_LAYOUT } from "./doc-templates";
import { buildRealDoc, metaWidget, refreshRealDoc, unavailableWidget } from "./meta-doc";
import type { AccountSnapshot } from "./report";

const range1 = { since: "2026-10-01", until: "2026-10-31" };
const range2 = { since: "2026-11-01", until: "2026-11-30" };
const ins = (spend: number, over: Record<string, unknown> = {}) => ({ spend, impressions: spend * 10, reach: spend * 8, clicks: spend / 2, ctr: 5, cpc: 2, cpm: 100, leads: 5, conversations: 0, costPerLead: 1, delivered: true, leadEvent: "lead", purchaseEvent: null, purchases: null, purchaseValue: null, ...over });
const snap = (id: string, name: string, spend: number, prevSpend: number | null): AccountSnapshot => ({ id, name, currency: "BRL", insights: ins(spend), ...(prevSpend !== null ? { previous: ins(prevSpend) } : {}), daily: [{ date: "2026-11-01", spend: 1, impressions: 1, reach: 1, clicks: 1 }] });

const built = () => buildRealDoc({ layout: DASHBOARD_LAYOUT, accounts: [snap("act_1", "Mesma", 100, 80), snap("act_2", "Mesma", 300, 200)], range: range1, newId: makeId, hideCover: true }).doc;
const metaBlocks = (d: ReportDoc) => d.blocks.filter((b) => b.network === "meta_ads");
const widgetOf = (b: Block, key: string) => b.widgets.find((w) => w.key === key)!;

describe("refreshRealDoc keeps what a person edited", () => {
  it("changes only the numbers: titles, texts, order, hidden blocks, highlight and size stay", () => {
    let doc = built();
    const [first, second] = metaBlocks(doc);
    doc = updateBlock(doc, first.id, { title: "Meta do cliente", analysis: "Texto que eu escrevi", hidden: false });
    doc = updateBlock(doc, second.id, { hidden: true, analysis: "Outro texto" });
    const spendId = widgetOf(first, "spend").id;
    doc = updateWidget(doc, spendId, { title: "Quanto investimos", description: "Texto meu", size: "wide" });
    doc = toggleHighlight(doc, spendId);
    // the person moved the blocks around: reverse the order of the Meta blocks
    const reordered: ReportDoc = { ...doc, blocks: [doc.blocks[0], ...doc.blocks.slice(1).reverse()] };

    const out = refreshRealDoc(reordered, [snap("act_1", "Mesma", 500, 250), snap("act_2", "Mesma", 700, 350)], range2).doc;

    expect(out.blocks.map((b) => b.id)).toEqual(reordered.blocks.map((b) => b.id));
    const f = out.blocks.find((b) => b.id === first.id)!;
    expect(f).toMatchObject({ title: "Meta do cliente", analysis: "Texto que eu escrevi", hidden: false });
    expect(out.blocks.find((b) => b.id === second.id)).toMatchObject({ hidden: true, analysis: "Outro texto" });
    expect(widgetOf(f, "spend")).toMatchObject({ id: spendId, title: "Quanto investimos", size: "wide", highlight: true, value: 500, previous: 250 });
    expect(widgetOf(f, "spend").description.startsWith("Texto meu")).toBe(true);
    expect(out.cover).toEqual(reordered.cover);
  });

  it("two accounts with the same name get their own numbers, by id", () => {
    const out = refreshRealDoc(built(), [snap("act_1", "Mesma", 11, 10), snap("act_2", "Mesma", 22, 20)], range2).doc;
    const [a, b] = metaBlocks(out);
    expect(a.accountId).toBe("act_1");
    expect(widgetOf(a, "spend")).toMatchObject({ value: 11 });
    expect(widgetOf(b, "spend")).toMatchObject({ value: 22 });
  });

  it("an indicator that was removed stays removed, and one that was added gets its numbers", () => {
    let doc = built();
    const block = metaBlocks(doc)[0];
    doc = deleteWidget(doc, widgetOf(block, "impressions").id);
    const extra = unavailableWidget(demoSource.widget("meta_ads", "purchases", { id: "x", range: range1, seed: "s" })!, "novo");
    // an added indicator with a supported key is filled in by the refresh
    const cpm = { ...(demoSource.widget("meta_ads", "cpc", { id: "added", range: range1, seed: "s" }) as MetricWidget) };
    doc = addWidgets(doc, block.id, [cpm]);
    void extra;
    const out = refreshRealDoc(doc, [snap("act_1", "Mesma", 100, 80), snap("act_2", "Mesma", 300, 200)], range2).doc;
    const b = metaBlocks(out)[0];
    expect(b.widgets.some((w) => w.key === "impressions")).toBe(false);
    const added = b.widgets.find((w) => w.id === "added") as MetricWidget;
    expect(added.value).toBe(2);
    expect(added.unavailable).toBeUndefined();
  });

  it("an indicator with a period of its own is not touched by the dashboard's period", () => {
    let doc = built();
    const w = widgetOf(metaBlocks(doc)[0], "spend");
    doc = updateWidget(doc, w.id, { period: { since: "2026-09-01", until: "2026-09-15" } });
    const old = (metaBlocks(doc)[0].widgets.find((x) => x.id === w.id) as MetricWidget).value;
    const out = refreshRealDoc(doc, [snap("act_1", "Mesma", 999, 1), snap("act_2", "Mesma", 999, 1)], range2).doc;
    expect(metaBlocks(out)[0].widgets.find((x) => x.id === w.id)).toMatchObject({ value: old });
  });

  it("an indicator whose comparison was turned off stays off", () => {
    let doc = built();
    const w = widgetOf(metaBlocks(doc)[0], "clicks");
    doc = updateWidget(doc, w.id, { comparison: false });
    const out = refreshRealDoc(doc, [snap("act_1", "Mesma", 100, 80), snap("act_2", "Mesma", 300, 200)], range2).doc;
    expect(widgetOf(metaBlocks(out)[0], "clicks")).toMatchObject({ comparison: false });
    expect(widgetOf(metaBlocks(out)[0], "spend")).toMatchObject({ comparison: true });
  });

  it("an account that could not be read leaves its indicators without numbers, with the reason, and says which", () => {
    const res = refreshRealDoc(built(), [snap("act_1", "Mesma", 100, 80), { id: "act_2", name: "Mesma", currency: "BRL", error: "permission" }], range2);
    const [a, b] = metaBlocks(res.doc);
    expect(widgetOf(a, "spend")).toMatchObject({ value: 100 });
    expect(widgetOf(b, "spend")).toMatchObject({ unavailable: expect.stringContaining("Não foi possível ler"), value: 0 });
    expect(res.unreadable).toEqual(["Mesma"]);
    // its title and text are still there
    expect(widgetOf(b, "spend").title).toBe(widgetOf(metaBlocks(built())[1], "spend").title);
  });

  it("a block of a network with no real source goes without numbers, never with the old ones", () => {
    const doc = built();
    const fake: Block = { id: "b_fake", kind: "network", network: "google_ads", title: "Google Ads", subtitle: "x", analysis: "meu texto", hidden: false, widgets: [demoSource.widget("google_ads", "g_clicks", { id: "g1", range: range1, seed: "s" }) as Widget] };
    const out = refreshRealDoc({ ...doc, blocks: [...doc.blocks, fake] }, [snap("act_1", "Mesma", 1, 1), snap("act_2", "Mesma", 1, 1)], range2).doc;
    const g = out.blocks.find((b) => b.id === "b_fake")!;
    expect(g.analysis).toBe("meu texto");
    expect(g.widgets[0]).toMatchObject({ unavailable: expect.stringContaining("fonte de dados real"), value: 0 });
  });

  it("the document stays valid and keeps the account id of each block", () => {
    const out = refreshRealDoc(built(), [snap("act_1", "Mesma", 1, 1), snap("act_2", "Mesma", 1, 1)], range2).doc;
    expect(parseDoc(JSON.parse(JSON.stringify(out)))).not.toBeNull();
    expect(metaBlocks(out).map((b) => b.accountId)).toEqual(["act_1", "act_2"]);
  });

  it("refuses a block whose account id is not an ad account id", () => {
    const doc = built();
    const bad = { ...doc, blocks: [{ ...doc.blocks[0], accountId: "Mesma" }, ...doc.blocks.slice(1)] };
    expect(parseDoc(JSON.parse(JSON.stringify(bad)))).toBeNull();
  });
});

describe("refreshDashboardDoc (marked models) keeps the edits too", () => {
  it("changes the made-up numbers but not the person's work", () => {
    const real = built();
    const model: ReportDoc = { ...real, demo: true };
    const block = metaBlocks(model)[0];
    const edited = updateBlock(model, block.id, { analysis: "Minha análise", title: "Título meu" });
    const out = refreshDashboardDoc(edited, range2, "seed");
    const b = out.blocks.find((x) => x.id === block.id)!;
    expect(b).toMatchObject({ analysis: "Minha análise", title: "Título meu" });
    expect(out.blocks.map((x) => x.id)).toEqual(edited.blocks.map((x) => x.id));
    expect(b.widgets.map((w) => w.id)).toEqual(block.widgets.map((w) => w.id));
  });
});

describe("the event and attribution note follows the refresh", () => {
  it("is replaced by the new one, never stacked, and the person's own text stays in front", () => {
    const a1 = { ...snap("act_1", "A", 100, 80), insights: ins(100, { purchaseEvent: "purchase", purchases: 3, purchaseValue: 300, attribution: { requested: null, mode: "meta_default" as const, effective: "7d_click" } }), previous: ins(80, { purchaseEvent: "purchase", purchases: 2, purchaseValue: 160 }) };
    const base = buildRealDoc({ layout: DASHBOARD_LAYOUT, accounts: [a1], range: range1, newId: makeId, hideCover: true }).doc;
    // the dashboard layout has no purchases indicator: add one, as a person can in the editor
    const doc = addWidgets(base, metaBlocks(base)[0].id, [metaWidget("purchases", a1, { id: "w_purchases", range: range1 }) as Widget]);
    const w = widgetOf(metaBlocks(doc)[0], "purchases");
    expect(w.description).toMatch(/\[Evento contado: purchase\. Atribuição aplicada pela Meta: 7d_click\.\]$/);
    const edited = updateWidget(doc, w.id, { description: "Minha explicação" + w.description.slice(w.description.indexOf(" [Evento")) });
    const a2 = { ...a1, insights: ins(120, { purchaseEvent: "omni_purchase", purchases: 4, purchaseValue: 400, attribution: { requested: ["1d_click"], mode: "explicit" as const, effective: "1d_click" } }) };
    const out = refreshRealDoc(edited, [a2], range2).doc;
    const d = widgetOf(metaBlocks(out)[0], "purchases").description;
    expect(d.startsWith("Minha explicação")).toBe(true);
    expect(d.match(/\[Evento contado/g)).toHaveLength(1);
    expect(d).toContain("Evento contado: omni_purchase");
    expect(d).toContain("pedida: 1d_click");
  });
});
