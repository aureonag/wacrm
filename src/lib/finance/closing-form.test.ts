import { describe, expect, it } from "vitest";
import { initialFinanceState, parseMoney, parsePct, toFinanceInput } from "./closing-form";
import { validateFinance } from "./closing";

describe("parseMoney", () => {
  it("reads Brazilian and plain formats", () => {
    expect(parseMoney("2.500,00")).toBe(2500);
    expect(parseMoney("2500,5")).toBe(2500.5);
    expect(parseMoney("2500.5")).toBe(2500.5);
    expect(parseMoney("1.500")).toBe(1500);
    expect(parseMoney("R$ 750")).toBe(750);
  });
  it("returns NaN for empty or garbage", () => {
    expect(parseMoney("")).toBeNaN();
    expect(parseMoney("abc")).toBeNaN();
  });
});

describe("parsePct", () => {
  it("accepts a comma decimal", () => {
    expect(parsePct("33,33")).toBe(33.33);
    expect(parsePct("")).toBeNaN();
  });
});

describe("initialFinanceState / toFinanceInput", () => {
  const state = initialFinanceState({
    client: { code: "00350", name: "Dr Aline Bueno" },
    monthlyItems: [{ id: "i1", label: "Gestão de tráfego", value: 2500 }],
    defaultProfileId: "p1",
  });

  it("prefills the client, the monthly value and 100% to the default seller", () => {
    expect(state.code).toBe("00350");
    expect(state.items[0].amount).toBe("2500");
    expect(state.commissions).toEqual([{ key: expect.any(String), profileId: "p1", pct: "100" }]);
  });

  it("is invalid until the line and first payment date are filled", () => {
    expect(validateFinance(toFinanceInput(state))).toBe("invalid_date");
    const ready = {
      ...state,
      firstPaymentDate: "2026-10-10",
      items: [{ ...state.items[0], serviceLineId: "line" }],
    };
    expect(validateFinance(toFinanceInput(ready))).toBeNull();
  });

  it("ignores the promo fields unless the promo toggle is on", () => {
    const off = toFinanceInput({ ...state, items: [{ ...state.items[0], promo: false, promoAmount: "999" }] });
    expect(off.items[0].promoMonths).toBe(0);
    expect(off.items[0].promoAmount).toBe(0);
    const on = toFinanceInput({ ...state, items: [{ ...state.items[0], promo: true, promoMonths: "3", promoAmount: "1.000,00" }] });
    expect(on.items[0].promoMonths).toBe(3);
    expect(on.items[0].promoAmount).toBe(1000);
  });
});
