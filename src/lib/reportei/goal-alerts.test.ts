import { describe, expect, it } from "vitest";
import { alertsFor, monthOf } from "./goal-alerts";
import { readGoals } from "./goals";

const client = { name: "Aureon", currency: "BRL" };
const goals = { monthlyBudget: 1000, maxCpc: 5 };
const read = (spend: number, cpc: number, today = "2026-11-15") =>
  readGoals({ totals: { spend, clicks: 100, cpc }, mixedCurrency: false }, goals, "this_month", today);

describe("alertsFor", () => {
  it("is quiet when everything is within the goals", () => {
    expect(alertsFor(read(400, 3), client, goals, { spend: 400, cpc: 3 })).toEqual([]);
  });

  it("warns about a fast pace", () => {
    const a = alertsFor(read(700, 3), client, goals, { spend: 700, cpc: 3 });
    expect(a.map((x) => x.kind)).toEqual(["budget_attention"]);
    expect(a[0].title).toContain("Aureon");
    expect(a[0].title).toContain("70%");
  });

  it("warns when the budget is gone, and about the CPC separately", () => {
    const a = alertsFor(read(1200, 8), client, goals, { spend: 1200, cpc: 8 });
    expect(a.map((x) => x.kind)).toEqual(["budget_over", "cpc_over"]);
    expect(a[0].body).toContain("R$");
  });
});

describe("monthOf", () => {
  it("keeps year and month", () => {
    expect(monthOf("2026-11-15")).toBe("2026-11");
  });
});
