import { describe, expect, it } from "vitest";
import { automationCompare, automationRange, automationTitle, dueDay, lastScheduledDay, periodRange } from "./automation";

describe("scheduled days", () => {
  it("weekly: the latest Monday on or before today", () => {
    expect(lastScheduledDay("weekly", "2026-11-04")).toBe("2026-11-02"); // Wednesday
    expect(lastScheduledDay("weekly", "2026-11-02")).toBe("2026-11-02"); // Monday
    expect(lastScheduledDay("weekly", "2026-11-08")).toBe("2026-11-02"); // Sunday
  });
  it("monthly: the 1st of the current month", () => {
    expect(lastScheduledDay("monthly", "2026-11-04")).toBe("2026-11-01");
    expect(lastScheduledDay("monthly", "2026-12-31")).toBe("2026-12-01");
  });
});

describe("ranges", () => {
  it("weekly covers Monday–Sunday before the run, compared with the week before", () => {
    const r = automationRange("weekly", "2026-11-02");
    expect(r).toEqual({ since: "2026-10-26", until: "2026-11-01" });
    expect(automationCompare(r)).toEqual({ since: "2026-10-19", until: "2026-10-25" });
  });
  it("monthly covers the previous month, compared with the month before it", () => {
    const r = automationRange("monthly", "2026-03-01");
    expect(r).toEqual({ since: "2026-02-01", until: "2026-02-28" });
    expect(automationCompare(r)).toEqual({ since: "2026-01-01", until: "2026-01-31" });
  });
  it("monthly handles the year change", () => {
    const r = automationRange("monthly", "2027-01-01");
    expect(r).toEqual({ since: "2026-12-01", until: "2026-12-31" });
    expect(automationCompare(r)).toEqual({ since: "2026-11-01", until: "2026-11-30" });
  });
});

describe("dueDay", () => {
  it("runs once per scheduled day", () => {
    expect(dueDay("weekly", "2026-11-02", null, "2026-10-01")).toBe("2026-11-02");
    expect(dueDay("weekly", "2026-11-03", "2026-11-02", "2026-10-01")).toBeNull();
  });
  it("catches up a missed day", () => {
    expect(dueDay("weekly", "2026-11-05", "2026-10-26", "2026-10-01")).toBe("2026-11-02");
  });
  it("a new automation waits for its first scheduled day", () => {
    expect(dueDay("weekly", "2026-11-04", null, "2026-11-04")).toBeNull();
    expect(dueDay("monthly", "2026-11-20", null, "2026-11-20")).toBeNull();
    expect(dueDay("monthly", "2026-12-01", null, "2026-11-20")).toBe("2026-12-01");
  });
});

describe("automationTitle", () => {
  it("names the period", () => {
    expect(automationTitle("weekly", "Aureon", { since: "2026-10-26", until: "2026-11-01" })).toBe("Relatório semanal · Aureon · 26/10 a 01/11");
    expect(automationTitle("monthly", "Aureon", { since: "2026-10-01", until: "2026-10-31" })).toBe("Relatório mensal · Aureon · 10/2026");
  });
});

describe("more frequencies", () => {
  it("daily is due every day", () => {
    expect(lastScheduledDay("daily", "2026-11-04")).toBe("2026-11-04");
    expect(dueDay("daily", "2026-11-05", "2026-11-04", "2026-10-01")).toBe("2026-11-05");
    expect(dueDay("daily", "2026-11-05", "2026-11-05", "2026-10-01")).toBeNull();
  });

  it("biweekly is due on the 1st and the 16th", () => {
    expect(lastScheduledDay("biweekly", "2026-11-04")).toBe("2026-11-01");
    expect(lastScheduledDay("biweekly", "2026-11-15")).toBe("2026-11-01");
    expect(lastScheduledDay("biweekly", "2026-11-16")).toBe("2026-11-16");
    expect(lastScheduledDay("biweekly", "2026-11-30")).toBe("2026-11-16");
  });

  it("biweekly reports the fortnight before the run", () => {
    expect(automationRange("biweekly", "2026-11-16")).toEqual({ since: "2026-11-01", until: "2026-11-15" });
    expect(automationRange("biweekly", "2026-11-01")).toEqual({ since: "2026-10-16", until: "2026-10-31" });
    expect(automationRange("biweekly", "2026-03-01")).toEqual({ since: "2026-02-16", until: "2026-02-28" });
  });
});

describe("analysis periods", () => {
  it("relative weeks and day counts", () => {
    // 2026-11-04 is a Wednesday
    expect(periodRange("previous_week_mon_sun", "2026-11-04")).toEqual({ since: "2026-10-26", until: "2026-11-01" });
    expect(periodRange("previous_week_sun_sat", "2026-11-04")).toEqual({ since: "2026-10-25", until: "2026-10-31" });
    expect(periodRange("last_7d_incl_today", "2026-11-04")).toEqual({ since: "2026-10-29", until: "2026-11-04" });
    expect(periodRange("last_7d_until_yesterday", "2026-11-04")).toEqual({ since: "2026-10-28", until: "2026-11-03" });
    expect(periodRange("last_15d", "2026-11-04")).toEqual({ since: "2026-10-20", until: "2026-11-03" });
    expect(periodRange("last_30d", "2026-11-04")).toEqual({ since: "2026-10-05", until: "2026-11-03" });
  });

  it("an explicit period overrides the frequency's own", () => {
    expect(automationRange("weekly", "2026-11-02", "previous_month")).toEqual({ since: "2026-10-01", until: "2026-10-31" });
  });

  it("compares a single month with the month before and anything else by length", () => {
    expect(automationCompare({ since: "2026-02-01", until: "2026-02-28" })).toEqual({ since: "2026-01-01", until: "2026-01-31" });
    expect(automationCompare({ since: "2026-11-01", until: "2026-11-15" })).toEqual({ since: "2026-10-17", until: "2026-10-31" });
  });
});

describe("custom titles", () => {
  it("fills the placeholders", () => {
    expect(automationTitle("weekly", "Aureon", { since: "2026-10-26", until: "2026-11-01" }, "Resumo {cliente} ({periodo})")).toBe("Resumo Aureon (26/10 a 01/11)");
  });

  it("names the new frequencies and ignores a blank custom title", () => {
    expect(automationTitle("biweekly", "A", { since: "2026-11-01", until: "2026-11-15" }, "  ")).toBe("Relatório quinzenal · A · 01/11 a 15/11");
    expect(automationTitle("daily", "A", { since: "2026-10-28", until: "2026-11-03" })).toContain("diário");
  });
});

import { daysBetween, nextScheduledDay } from "./automation";

describe("nextScheduledDay", () => {
  it("daily: tomorrow", () => {
    expect(nextScheduledDay("daily", "2026-11-30")).toBe("2026-12-01");
  });

  it("weekly: the next Monday, never today", () => {
    expect(nextScheduledDay("weekly", "2026-11-04")).toBe("2026-11-09"); // Wednesday
    expect(nextScheduledDay("weekly", "2026-11-02")).toBe("2026-11-09"); // Monday itself
    expect(nextScheduledDay("weekly", "2026-11-08")).toBe("2026-11-09"); // Sunday
  });

  it("biweekly: the 16th or the 1st of next month", () => {
    expect(nextScheduledDay("biweekly", "2026-11-04")).toBe("2026-11-16");
    expect(nextScheduledDay("biweekly", "2026-11-16")).toBe("2026-12-01");
    expect(nextScheduledDay("biweekly", "2026-12-20")).toBe("2027-01-01");
  });

  it("monthly: the 1st of next month, across the year change", () => {
    expect(nextScheduledDay("monthly", "2026-11-04")).toBe("2026-12-01");
    expect(nextScheduledDay("monthly", "2026-12-31")).toBe("2027-01-01");
  });

  it("is always after today and counts the days between", () => {
    for (const f of ["daily", "weekly", "biweekly", "monthly"] as const) {
      expect(daysBetween("2026-11-04", nextScheduledDay(f, "2026-11-04"))).toBeGreaterThan(0);
    }
    expect(daysBetween("2026-11-04", "2026-11-09")).toBe(5);
  });
});
