import { describe, expect, it } from "vitest";
import { isPeriod, resolvePeriod } from "./periods";

// 2026-11-15 12:00 in São Paulo (UTC-3) is 15:00Z.
const now = new Date("2026-11-15T15:00:00Z");

describe("resolvePeriod", () => {
  it("covers the last 7 and 30 days ending today", () => {
    expect(resolvePeriod("last_7d", now)).toEqual({ since: "2026-11-09", until: "2026-11-15" });
    expect(resolvePeriod("last_30d", now)).toEqual({ since: "2026-10-17", until: "2026-11-15" });
  });

  it("covers this month so far and the whole previous month", () => {
    expect(resolvePeriod("this_month", now)).toEqual({ since: "2026-11-01", until: "2026-11-15" });
    expect(resolvePeriod("last_month", now)).toEqual({ since: "2026-10-01", until: "2026-10-31" });
  });

  it("uses São Paulo's date, not UTC's, just after midnight there", () => {
    // 01:30Z on the 16th is still the 15th (22:30) in São Paulo.
    expect(resolvePeriod("last_7d", new Date("2026-11-16T01:30:00Z")).until).toBe("2026-11-15");
  });

  it("handles January for the previous month", () => {
    expect(resolvePeriod("last_month", new Date("2027-01-10T15:00:00Z"))).toEqual({ since: "2026-12-01", until: "2026-12-31" });
  });
});

describe("isPeriod", () => {
  it("accepts only the known periods", () => {
    expect(isPeriod("last_30d")).toBe(true);
    expect(isPeriod("yesterday")).toBe(false);
    expect(isPeriod(undefined)).toBe(false);
  });
});
