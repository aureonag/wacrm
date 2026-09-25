import { describe, expect, it } from "vitest";
import {
  buildMonthlySchedule,
  commissionCategoryName,
  firstMonthTotal,
  parseDealTitle,
  splitCommission,
  validateFinance,
  type FinanceInput,
} from "./closing";

describe("parseDealTitle", () => {
  it("splits code and name", () => {
    expect(parseDealTitle("00350 - Dr Aline Bueno")).toEqual({ code: "00350", name: "Dr Aline Bueno" });
  });
  it("drops the complement after a pipe", () => {
    expect(parseDealTitle("00349 - ProSport | Fabricante Dryfit Brás-SP")).toEqual({ code: "00349", name: "ProSport" });
  });
  it("accepts an en dash and stray spaces", () => {
    expect(parseDealTitle("  123 – Acme  ")).toEqual({ code: "123", name: "Acme" });
  });
  it("leaves the code empty when the title has none", () => {
    expect(parseDealTitle("Cliente sem código")).toEqual({ code: null, name: "Cliente sem código" });
  });
});

describe("buildMonthlySchedule", () => {
  it("runs from the first payment month through December at the full price", () => {
    const s = buildMonthlySchedule({ firstPaymentDate: "2026-10-15", amount: 1000, promoMonths: 0, promoAmount: 0 });
    expect(s.map((e) => e.month)).toEqual([10, 11, 12]);
    expect(s.every((e) => e.year === 2026 && e.amount === 1000)).toBe(true);
  });
  it("applies the promotional price for the first N months, then the full price", () => {
    const s = buildMonthlySchedule({ firstPaymentDate: "2026-03-05", amount: 1500, promoMonths: 3, promoAmount: 750 });
    expect(s.slice(0, 4).map((e) => e.amount)).toEqual([750, 750, 750, 1500]);
    expect(s).toHaveLength(10);
  });
  it("returns nothing for an invalid date", () => {
    expect(buildMonthlySchedule({ firstPaymentDate: "2026-02-31", amount: 1, promoMonths: 0, promoAmount: 0 })).toEqual([]);
  });
});

describe("splitCommission", () => {
  it("splits by percentage and always sums to the base", () => {
    const shares = splitCommission(1000, [
      { profileId: "a", pct: 70 },
      { profileId: "b", pct: 30 },
    ]);
    expect(shares.map((s) => s.amount)).toEqual([700, 300]);
  });
  it("gives the leftover cent to the first recipient", () => {
    const shares = splitCommission(100, [
      { profileId: "a", pct: 33.33 },
      { profileId: "b", pct: 33.33 },
      { profileId: "c", pct: 33.34 },
    ]);
    const total = Math.round(shares.reduce((s, r) => s + r.amount * 100, 0));
    expect(total).toBe(10000);
  });
});

describe("commissionCategoryName", () => {
  it("uses the first name, matching the existing expense categories", () => {
    expect(commissionCategoryName("Felipe Cordeiro Queiroz")).toBe("Comissão Felipe");
    expect(commissionCategoryName("  Matheus ")).toBe("Comissão Matheus");
  });
});

const base: FinanceInput = {
  firstPaymentDate: "2026-10-10",
  items: [{ serviceLineId: "line", code: "00350", name: "Dr Aline", amount: 2500, promoMonths: 0, promoAmount: 0 }],
  commissions: [{ profileId: "a", pct: 100 }],
};

describe("validateFinance", () => {
  it("accepts a well-formed sheet", () => {
    expect(validateFinance(base)).toBeNull();
  });
  it("rejects a bad date, no items, bad amounts", () => {
    expect(validateFinance({ ...base, firstPaymentDate: "10/10/2026" })).toBe("invalid_date");
    expect(validateFinance({ ...base, items: [] })).toBe("no_items");
    expect(validateFinance({ ...base, items: [{ ...base.items[0], amount: 0 }] })).toBe("invalid_item");
    expect(validateFinance({ ...base, items: [{ ...base.items[0], serviceLineId: "" }] })).toBe("invalid_item");
  });
  it("rejects an out-of-range promo", () => {
    expect(validateFinance({ ...base, items: [{ ...base.items[0], promoMonths: 12 }] })).toBe("invalid_promo");
  });
  it("requires the commission percentages to add up to 100", () => {
    expect(
      validateFinance({ ...base, commissions: [{ profileId: "a", pct: 70 }, { profileId: "b", pct: 20 }] }),
    ).toBe("commission_sum");
    expect(
      validateFinance({ ...base, commissions: [{ profileId: "a", pct: 70 }, { profileId: "b", pct: 30 }] }),
    ).toBeNull();
  });
  it("rejects a repeated recipient and allows no commission at all", () => {
    expect(
      validateFinance({ ...base, commissions: [{ profileId: "a", pct: 50 }, { profileId: "a", pct: 50 }] }),
    ).toBe("invalid_commission");
    expect(validateFinance({ ...base, commissions: [] })).toBeNull();
  });
});

describe("firstMonthTotal", () => {
  it("sums the first payment across items, using the promo price when there is one", () => {
    const total = firstMonthTotal({
      ...base,
      items: [
        { serviceLineId: "l1", code: null, name: "A", amount: 2000, promoMonths: 3, promoAmount: 1000 },
        { serviceLineId: "l2", code: null, name: "B", amount: 500, promoMonths: 0, promoAmount: 0 },
      ],
    });
    expect(total).toBe(1500);
  });
});
