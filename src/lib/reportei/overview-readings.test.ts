import { describe, expect, it } from "vitest";
import { buildRealDoc, metaWidget } from "./meta-doc";
import { makeId } from "./doc";
import { findBuiltin } from "./doc-templates";
import { readingsOf } from "./overview-readings";
import type { AccountSnapshot } from "./report";

const ins = (over: Partial<NonNullable<AccountSnapshot["insights"]>> = {}) => ({ spend: 100, impressions: 1000, reach: 800, clicks: 50, ctr: 5, cpc: 2, cpm: 100, leads: 10, conversations: 0, costPerLead: 10, delivered: true, leadEvent: "lead", purchaseEvent: "purchase", purchases: 4, purchaseValue: 400, ...over });
const acct = (over: Partial<AccountSnapshot> = {}): AccountSnapshot => ({ id: "act_1", name: "A", currency: "BRL", insights: ins(), previous: ins({ spend: 80, leads: 8, purchases: 2, purchaseValue: 160 }), ...over });
const get = (list: ReturnType<typeof readingsOf>["readings"], key: string) => list.find((r) => r.key === key)!;

describe("readingsOf", () => {
  it("one readable account: real values, same event for quantity and value", () => {
    const out = readingsOf([acct()]);
    expect(out.status).toBe("ok");
    expect(get(out.readings, "purchases")).toMatchObject({ value: 4, previous: 2 });
    expect(get(out.readings, "revenue")).toMatchObject({ value: 400, previous: 160 });
    expect(get(out.readings, "roas")).toMatchObject({ value: 4, previous: 2 });
    expect(get(out.readings, "cpl")).toMatchObject({ value: 10, previous: 10 });
  });

  it("accounts that count purchases with different events are not added: unavailable, with the reason", () => {
    const out = readingsOf([acct(), acct({ id: "act_2", insights: ins({ purchaseEvent: "omni_purchase" }), previous: ins({ purchaseEvent: "omni_purchase" }) })]);
    for (const key of ["purchases", "revenue", "roas", "cpa"]) expect(get(out.readings, key)).toMatchObject({ value: null, why: "mixed_events" });
    // leads still use the same event: they add up
    expect(get(out.readings, "leads").value).toBe(20);
  });

  it("accounts that count leads with different events do not add leads or CPL", () => {
    const out = readingsOf([acct(), acct({ id: "act_2", insights: ins({ leadEvent: "offsite_conversion.fb_pixel_lead" }), previous: ins({ leadEvent: "offsite_conversion.fb_pixel_lead" }) })]);
    expect(get(out.readings, "leads")).toMatchObject({ value: null, why: "mixed_events" });
    expect(get(out.readings, "cpl")).toMatchObject({ value: null, why: "mixed_events" });
  });

  it("an account that recorded no purchase event leaves purchases unavailable, not zero", () => {
    const out = readingsOf([acct({ insights: ins({ purchaseEvent: null, purchases: null, purchaseValue: null }), previous: ins({ purchaseEvent: null, purchases: null, purchaseValue: null }) })]);
    expect(get(out.readings, "purchases")).toMatchObject({ value: null, why: "no_events" });
    expect(get(out.readings, "revenue")).toMatchObject({ value: null, why: "no_events" });
  });

  it("a partial read judges nothing", () => {
    const out = readingsOf([acct(), { id: "x", name: "X", currency: "BRL", error: "permission" }]);
    expect(out.status).toBe("partial");
    expect(out.readings.every((r) => r.value === null)).toBe(true);
  });
});

describe("the chosen event stays visible in the document", () => {
  const snap = acct();
  const w = (key: string, s = snap) => metaWidget(key, s, { id: "w", range: { since: "2026-10-01", until: "2026-10-31" } });

  it("names the event that counted leads and purchases in the indicator", () => {
    expect(w("purchases")).toMatchObject({ description: expect.stringContaining("Evento contado: purchase") });
    expect(w("roas")).toMatchObject({ description: expect.stringContaining("Evento contado: purchase") });
    expect(w("leads")).toMatchObject({ description: expect.stringContaining("Evento contado: lead") });
    expect(w("spend")?.description).not.toContain("Evento contado");
  });

  it("the Bloco Personalizado does not add leads counted by different events", () => {
    const layout = findBuiltin("builtin:trafego-pago")!.layout;
    const two = [acct(), acct({ id: "act_2", name: "B", insights: ins({ leadEvent: "offsite_conversion.fb_pixel_lead" }) })];
    const out = buildRealDoc({ layout, accounts: two, range: { since: "2026-10-01", until: "2026-10-31" }, newId: makeId });
    const leads = out.doc.blocks[0].widgets.find((x) => x.key === "total_leads");
    if (leads) expect(leads).toMatchObject({ unavailable: expect.stringContaining("eventos diferentes") });
  });
});
