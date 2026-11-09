import { describe, expect, it } from "vitest";
import { makeId } from "./doc";
import { DASHBOARD_LAYOUT, findBuiltin } from "./doc-templates";
import { buildRealDoc, metaWidget } from "./meta-doc";
import type { AccountSnapshot } from "./report";

const range = { since: "2026-10-01", until: "2026-10-31" };
const insights = (over: Partial<NonNullable<AccountSnapshot["insights"]>> = {}) => ({ spend: 100, impressions: 1000, reach: 800, clicks: 50, ctr: 5, cpc: 2, cpm: 100, leads: 8, conversations: 0, costPerLead: 12.5, delivered: true, purchases: null, purchaseValue: null, ...over });
const snap = (over: Partial<AccountSnapshot> = {}): AccountSnapshot => ({ id: "act_1", name: "Conta 1", currency: "BRL", insights: insights(), ...over });
const widget = (key: string, s: AccountSnapshot) => metaWidget(key, s, { id: "w1", range });

describe("metaWidget", () => {
  it("carries the account currency into real monetary widgets", () => {
    expect(widget("spend", snap({ currency: "USD" }))).toMatchObject({ kind: "metric", currency: "USD", value: 100 });
  });
  it("takes the real value and the previous period's", () => {
    const w = widget("spend", snap({ previous: insights({ spend: 80 }) }));
    expect(w).toMatchObject({ kind: "metric", value: 100, previous: 80, comparison: true, networks: ["meta_ads"] });
    expect((w as { unavailable?: string }).unavailable).toBeUndefined();
  });

  it("has no comparison when the previous period could not be read", () => {
    expect(widget("clicks", snap())).toMatchObject({ value: 50, previous: null, comparison: false });
  });

  it("marks purchases as unavailable, not zero, when the account recorded none", () => {
    for (const key of ["purchases", "purchase_value", "roas", "cost_per_purchase"]) {
      expect(widget(key, snap())).toMatchObject({ unavailable: expect.stringContaining("compra"), value: 0, comparison: false });
    }
  });

  it("computes ROAS and cost per purchase from the one purchase event", () => {
    const s = snap({ insights: insights({ purchases: 4, purchaseValue: 400 }) });
    expect(widget("roas", s)).toMatchObject({ value: 4 });
    expect(widget("cost_per_purchase", s)).toMatchObject({ value: 25 });
  });

  it("has no cost per lead without leads", () => {
    expect(widget("cost_per_lead", snap({ insights: insights({ leads: 0 }) }))).toMatchObject({ unavailable: expect.stringContaining("leads") });
    expect(widget("cost_per_lead", snap())).toMatchObject({ value: 12.5 });
  });

  it("an indicator Meta does not feed yet is unavailable, with no invented data", () => {
    const w = widget("campaigns", snap()) as { unavailable?: string; rows: unknown[] };
    expect(w.unavailable).toBeTruthy();
    expect(w.rows).toEqual([]);
  });

  it("daily charts use the real days, or say they could not be read", () => {
    const withDays = widget("spend_daily", snap({ daily: [{ date: "2026-10-01", spend: 5, impressions: 1, reach: 1, clicks: 1 }] }));
    expect(withDays).toMatchObject({ points: [{ label: "01/10/2026", value: 5 }] });
    expect((widget("spend_daily", snap()) as { unavailable?: string }).unavailable).toBeTruthy();
  });

  it("an account that could not be read has no widgets", () => {
    expect(widget("spend", { id: "a", name: "A", currency: "BRL", error: "permission" })).toBeNull();
  });
});

describe("buildRealDoc", () => {
  const layout = findBuiltin("builtin:trafego-pago")!.layout;

  it("is not a demo, one block per readable Meta account, and lists the networks it left out", () => {
    const out = buildRealDoc({ layout: DASHBOARD_LAYOUT, accounts: [snap(), snap({ id: "act_2", name: "Conta 2" })], range, newId: makeId });
    expect(out.doc.demo).toBe(false);
    expect(out.doc.blocks.filter((b) => b.network === "meta_ads").map((b) => b.subtitle)).toEqual(["Conta 1", "Conta 2"]);
    expect(out.skipped).toEqual(expect.arrayContaining(["google_ads", "instagram_business", "facebook"]));
    expect(out.doc.blocks.some((b) => b.network === "google_ads")).toBe(false);
  });

  it("lists the accounts it could not read and does not make blocks for them", () => {
    const out = buildRealDoc({ layout, accounts: [snap(), { id: "act_9", name: "Quebrada", currency: "BRL", error: "token_invalid" }], range, newId: makeId });
    expect(out.unreadable).toEqual([{ account: "Quebrada", error: "token_invalid" }]);
    expect(out.doc.blocks.filter((b) => b.network === "meta_ads")).toHaveLength(1);
  });

  it("does not add money across currencies in the custom block", () => {
    const out = buildRealDoc({ layout: DASHBOARD_LAYOUT, accounts: [snap(), snap({ id: "act_2", name: "USD", currency: "USD" })], range, newId: makeId });
    const spend = out.doc.blocks[0].widgets.find((w) => w.key === "total_spend");
    expect(spend).toMatchObject({ unavailable: expect.stringContaining("moedas") });
  });

  it("has no blocks when no account can be read", () => {
    const out = buildRealDoc({ layout, accounts: [{ id: "a", name: "A", currency: null, error: "request_failed" }], range, newId: makeId });
    expect(out.doc.blocks).toEqual([]);
  });
});
