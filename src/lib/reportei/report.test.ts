import { describe, expect, it } from "vitest";
import { fillDays, isValidRange, isYmd, previousRange, rangeDays, toneFor, variation } from "./report";

describe("ranges", () => {
  it("counts both ends", () => {
    expect(rangeDays("2026-11-01", "2026-11-01")).toBe(1);
    expect(rangeDays("2026-10-05", "2026-11-03")).toBe(30);
  });

  it("previous range has the same length and ends the day before", () => {
    expect(previousRange("2026-10-05", "2026-11-03")).toEqual({ since: "2026-09-05", until: "2026-10-04" });
    expect(previousRange("2026-11-01", "2026-11-03")).toEqual({ since: "2026-10-29", until: "2026-10-31" });
    expect(previousRange("2026-03-01", "2026-03-31")).toEqual({ since: "2026-01-29", until: "2026-02-28" });
  });

  it("validates dates", () => {
    expect(isYmd("2026-02-30")).toBe(false);
    expect(isYmd("2026-2-3")).toBe(false);
    expect(isYmd("2026-11-03")).toBe(true);
  });

  it("rejects bad ranges", () => {
    const today = "2026-11-03";
    expect(isValidRange("2026-10-01", "2026-10-31", today)).toBe(true);
    expect(isValidRange("2026-10-31", "2026-10-01", today)).toBe(false);
    expect(isValidRange("2026-10-01", "2026-11-04", today)).toBe(false);
    expect(isValidRange("2025-01-01", "2026-11-03", today)).toBe(false);
    expect(isValidRange("nope", "2026-11-03", today)).toBe(false);
  });
});

describe("variation", () => {
  it("is the percent change", () => {
    expect(variation(150, 100)).toBe(50);
    expect(variation(50, 100)).toBe(-50);
  });
  it("is null without a base", () => {
    expect(variation(10, 0)).toBeNull();
    expect(variation(Number.NaN, 5)).toBeNull();
  });
});

describe("toneFor", () => {
  it("rewards growth in results and drops in cost", () => {
    expect(toneFor("clicks", 10)).toBe("good");
    expect(toneFor("clicks", -10)).toBe("bad");
    expect(toneFor("cpc", -10)).toBe("good");
    expect(toneFor("cpm", 10)).toBe("bad");
  });
  it("does not judge spend, flat or unknown changes", () => {
    expect(toneFor("spend", 40)).toBe("neutral");
    expect(toneFor("clicks", 0.01)).toBe("neutral");
    expect(toneFor("reach", null)).toBe("neutral");
  });
});

describe("fillDays", () => {
  const day = (date: string, spend = 0) => ({ date, spend, impressions: 0, reach: 0, clicks: 0 });

  it("returns one point per day, zero-filling the days Meta skipped", () => {
    const out = fillDays([day("2026-10-01", 5), day("2026-10-03", 7)], "2026-10-01", "2026-10-04");
    expect(out.map((p) => p.date)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
    expect(out.map((p) => p.spend)).toEqual([5, 0, 7, 0]);
  });

  it("ignores days outside the range and keeps the total", () => {
    const out = fillDays([day("2026-09-30", 99), day("2026-10-01", 3), day("2026-10-02", 4)], "2026-10-01", "2026-10-02");
    expect(out.reduce((s, p) => s + p.spend, 0)).toBe(7);
  });
});

import { visibleMetrics } from "./report";

describe("visibleMetrics", () => {
  const base = { spend: 10, impressions: 100, reach: 80, clicks: 5, ctr: 5, cpc: 2, cpm: 100, leads: 0, conversations: 0, costPerLead: 0 };
  const wanted = ["spend", "leads", "conversations", "costPerLead"] as const;

  it("hides result metrics that are zero in both periods", () => {
    expect(visibleMetrics(wanted, base, base)).toEqual(["spend"]);
  });

  it("shows them when this period or the previous one had results", () => {
    expect(visibleMetrics(wanted, { ...base, leads: 3, costPerLead: 3.33 })).toEqual(["spend", "leads", "costPerLead"]);
    expect(visibleMetrics(wanted, base, { ...base, conversations: 2 })).toEqual(["spend", "conversations"]);
  });

  it("skips metrics a report saved before they existed does not have", () => {
    const old = { spend: 10, impressions: 100, reach: 80, clicks: 5, ctr: 5, cpc: 2, cpm: 100 } as unknown as typeof base;
    expect(visibleMetrics(wanted, old)).toEqual(["spend"]);
  });
});
