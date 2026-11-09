import { describe, expect, it } from "vitest";
import type { AccountSnapshot } from "./report";
import { TtlCache, change, mapLimit, overallTotals, sortSummaries, summarizeClient } from "./dashboard";

const ins = (spend: number, impressions: number, clicks: number) => ({ spend, impressions, reach: 0, clicks, ctr: 0, cpc: 0, cpm: 0, leads: 0, conversations: 0, costPerLead: 0 });
const acc = (over: Partial<AccountSnapshot>): AccountSnapshot => ({ id: "act_1", name: "A", currency: "BRL", ...over });
const who = { clientId: "c1", name: "Aureon", code: "AU" };

describe("summarizeClient", () => {
  it("sums the accounts and derives CTR and CPC from the totals", () => {
    const s = summarizeClient(who, [acc({ insights: ins(100, 1000, 50) }), acc({ id: "act_2", insights: ins(50, 1000, 25) })]);
    expect(s.totals).toEqual({ spend: 150, impressions: 2000, clicks: 75, ctr: 3.75, cpc: 2 });
    expect(s.accounts).toBe(2);
    expect(s.readable).toBe(2);
    expect(s.currency).toBe("BRL");
    expect(s.error).toBeNull();
  });

  it("keeps the readable accounts and reports the error only when none is readable", () => {
    const some = summarizeClient(who, [acc({ insights: ins(10, 100, 5) }), acc({ id: "act_2", error: "token_invalid" })]);
    expect(some.readable).toBe(1);
    expect(some.error).toBeNull();
    const none = summarizeClient(who, [acc({ error: "permission" })]);
    expect(none.totals).toBeNull();
    expect(none.error).toBe("permission");
  });

  it("does not sum money across currencies", () => {
    const s = summarizeClient(who, [acc({ insights: ins(100, 1000, 50) }), acc({ id: "act_2", currency: "USD", insights: ins(10, 1000, 10) })]);
    expect(s.mixedCurrency).toBe(true);
    expect(s.currency).toBeNull();
    expect(s.totals).toMatchObject({ spend: 0, cpc: 0, clicks: 60 });
  });

  it("compares only when every readable account has its previous numbers", () => {
    const full = summarizeClient(who, [acc({ insights: ins(200, 1000, 100), previous: ins(100, 1000, 100) })]);
    expect(change(full, "spend")).toBe(100);
    const partial = summarizeClient(who, [acc({ insights: ins(200, 1000, 100), previous: ins(100, 1000, 100) }), acc({ id: "act_2", insights: ins(1, 1, 1) })]);
    expect(partial.previous).toBeNull();
    expect(change(partial, "spend")).toBeNull();
  });

  it("handles zero impressions and clicks", () => {
    const s = summarizeClient(who, [acc({ insights: ins(0, 0, 0) })]);
    expect(s.totals).toEqual({ spend: 0, impressions: 0, clicks: 0, ctr: 0, cpc: 0 });
  });
});

describe("sortSummaries", () => {
  const mk = (name: string, spend: number | null) =>
    summarizeClient({ clientId: name, name, code: null }, spend === null ? [acc({ error: "request_failed" })] : [acc({ insights: ins(spend, 100, 10) })]);

  it("sorts numbers high to low with the clients without data last", () => {
    const sorted = sortSummaries([mk("B", null), mk("A", 10), mk("C", 30)], "spend");
    expect(sorted.map((s) => s.name)).toEqual(["C", "A", "B"]);
  });

  it("sorts names A to Z and does not change the input", () => {
    const input = [mk("b", 1), mk("a", 2)];
    expect(sortSummaries(input, "name").map((s) => s.name)).toEqual(["a", "b"]);
    expect(input.map((s) => s.name)).toEqual(["b", "a"]);
  });
});

describe("mapLimit", () => {
  it("keeps the order and never exceeds the limit", async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12]);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("handles an empty list", async () => {
    expect(await mapLimit([], 3, async (x) => x)).toEqual([]);
  });
});

describe("TtlCache", () => {
  it("returns a value until it expires", () => {
    const c = new TtlCache<number>(1000);
    c.set("k", 1, 0);
    expect(c.get("k", 999)).toBe(1);
    expect(c.get("k", 1001)).toBeUndefined();
  });

  it("drops the oldest entry past the maximum", () => {
    const c = new TtlCache<number>(1000, 2);
    c.set("a", 1, 0);
    c.set("b", 2, 0);
    c.set("c", 3, 0);
    expect(c.get("a", 1)).toBeUndefined();
    expect(c.get("c", 1)).toBe(3);
  });
});

describe("overallTotals", () => {
  const client = (id: string, currency: string, spend: number, impressions: number, clicks: number) =>
    summarizeClient({ clientId: id, name: id, code: null }, [acc({ currency, insights: ins(spend, impressions, clicks) })]);

  it("adds up the clients and derives the rates from the sums", () => {
    const all = overallTotals([client("a", "BRL", 100, 1000, 50), client("b", "BRL", 50, 1000, 25)]);
    expect(all.totals).toEqual({ spend: 150, impressions: 2000, clicks: 75, ctr: 3.75, cpc: 2 });
    expect(all.clients).toBe(2);
    expect(all.currency).toBe("BRL");
  });

  it("does not add money across currencies", () => {
    const all = overallTotals([client("a", "BRL", 100, 1000, 50), client("b", "USD", 50, 1000, 25)]);
    expect(all.mixedCurrency).toBe(true);
    expect(all.totals).toMatchObject({ spend: 0, cpc: 0, clicks: 75 });
  });

  it("skips clients without data and is empty when none has any", () => {
    const none = summarizeClient({ clientId: "n", name: "n", code: null }, [acc({ error: "permission" })]);
    expect(overallTotals([none, client("a", "BRL", 10, 100, 5)]).clients).toBe(1);
    expect(overallTotals([none]).totals).toBeNull();
  });
});
