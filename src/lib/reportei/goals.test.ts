import { describe, expect, it } from "vitest";
import { budgetProgress, cpcStatus, goalsFromRow, parseGoals, readGoals } from "./goals";

describe("parseGoals", () => {
  it("accepts numbers, comma decimals and empty values", () => {
    expect(parseGoals({ monthlyBudget: "1500,50", maxCpc: 2 })).toEqual({ monthlyBudget: 1500.5, maxCpc: 2 });
    expect(parseGoals({ monthlyBudget: "", maxCpc: null })).toEqual({ monthlyBudget: null, maxCpc: null });
    expect(parseGoals({})).toEqual({ monthlyBudget: null, maxCpc: null });
  });

  it("rounds to cents and refuses invalid values", () => {
    expect(parseGoals({ monthlyBudget: 10.456 })?.monthlyBudget).toBe(10.46);
    expect(parseGoals({ monthlyBudget: 0 })).toBeNull();
    expect(parseGoals({ monthlyBudget: -5 })).toBeNull();
    expect(parseGoals({ maxCpc: "abc" })).toBeNull();
    expect(parseGoals({ monthlyBudget: 1e12 })).toBeNull();
    expect(parseGoals(null)).toBeNull();
  });
});

describe("budgetProgress", () => {
  it("is ok when spending follows the calendar", () => {
    const p = budgetProgress(500, 1000, "2026-11-15"); // 50% of the budget, 15/30 of the month
    expect(p?.status).toBe("ok");
    expect(p?.percent).toBe(50);
    expect(p?.monthPercent).toBe(50);
  });

  it("warns when spending runs more than 15 points ahead of the month", () => {
    expect(budgetProgress(700, 1000, "2026-11-15")?.status).toBe("attention");
    expect(budgetProgress(650, 1000, "2026-11-15")?.status).toBe("ok");
  });

  it("is over at or past 100%", () => {
    expect(budgetProgress(1000, 1000, "2026-11-30")?.status).toBe("over");
    expect(budgetProgress(1200, 1000, "2026-11-20")?.percent).toBe(120);
  });

  it("returns null without a usable budget", () => {
    expect(budgetProgress(10, null, "2026-11-15")).toBeNull();
    expect(budgetProgress(10, 0, "2026-11-15")).toBeNull();
  });

  it("knows the length of February", () => {
    expect(budgetProgress(0, 100, "2028-02-29")?.monthPercent).toBe(100);
  });
});

describe("cpcStatus", () => {
  it("compares the CPC with the goal", () => {
    expect(cpcStatus(2.5, 2, 100)).toBe("over");
    expect(cpcStatus(1.5, 2, 100)).toBe("ok");
    expect(cpcStatus(2, 2, 100)).toBe("ok");
  });

  it("says nothing without a goal or without clicks", () => {
    expect(cpcStatus(2.5, null, 100)).toBeNull();
    expect(cpcStatus(0, 2, 0)).toBeNull();
  });
});

describe("goalsFromRow", () => {
  it("reads numerics that arrive as strings", () => {
    expect(goalsFromRow({ monthly_budget: "1500.00", max_cpc: null })).toEqual({ monthlyBudget: 1500, maxCpc: null });
    expect(goalsFromRow(null)).toEqual({ monthlyBudget: null, maxCpc: null });
  });
});

describe("readGoals", () => {
  const summary = { totals: { spend: 800, clicks: 100, cpc: 8 }, mixedCurrency: false };
  const goals = { monthlyBudget: 1000, maxCpc: 5 };

  it("reads the budget only for the current month and the CPC always", () => {
    const month = readGoals(summary, goals, "this_month", "2026-11-15");
    expect(month.budget?.status).toBe("attention");
    expect(month.cpc).toBe("over");
    const other = readGoals(summary, goals, "last_30d", "2026-11-15");
    expect(other.budget).toBeNull();
    expect(other.cpc).toBe("over");
  });

  it("reads nothing without goals, without data or with mixed currencies", () => {
    expect(readGoals(summary, undefined, "this_month", "2026-11-15")).toEqual({ budget: null, cpc: null });
    expect(readGoals({ totals: null, mixedCurrency: false }, goals, "this_month", "2026-11-15")).toEqual({ budget: null, cpc: null });
    expect(readGoals({ ...summary, mixedCurrency: true }, goals, "this_month", "2026-11-15")).toEqual({ budget: null, cpc: null });
  });
});
