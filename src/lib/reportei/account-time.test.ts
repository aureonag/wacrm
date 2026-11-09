import { describe, expect, it } from "vitest";
import { accountToday, rangeForAccount } from "./account-time";

describe("accountToday", () => {
  it("is the date in the account's own zone, which can differ from another zone", () => {
    const now = new Date("2026-11-06T02:30:00Z"); // still the 5th in São Paulo (UTC-3), already the 6th in UTC
    expect(accountToday("America/Sao_Paulo", now)).toBe("2026-11-05");
    expect(accountToday("UTC", now)).toBe("2026-11-06");
    expect(accountToday("Asia/Tokyo", now)).toBe("2026-11-06");
    expect(accountToday("America/Los_Angeles", now)).toBe("2026-11-05");
  });
  it("is null for an unknown or missing zone (nothing is assumed)", () => {
    expect(accountToday(null)).toBeNull();
    expect(accountToday("")).toBeNull();
    expect(accountToday("Not/AZone")).toBeNull();
  });
});

describe("rangeForAccount", () => {
  it("leaves a range that is already past, and any range when the zone is unknown", () => {
    expect(rangeForAccount({ since: "2026-10-01", until: "2026-10-31" }, "2026-11-05")).toEqual({ range: { since: "2026-10-01", until: "2026-10-31" }, clamped: false, empty: false });
    expect(rangeForAccount({ since: "2026-10-01", until: "2026-12-31" }, null).clamped).toBe(false);
  });
  it("never asks for days that have not started in the account's zone", () => {
    expect(rangeForAccount({ since: "2026-11-01", until: "2026-11-06" }, "2026-11-05")).toEqual({ range: { since: "2026-11-01", until: "2026-11-05" }, clamped: true, empty: false });
  });
  it("a range wholly in the account's future is empty", () => {
    expect(rangeForAccount({ since: "2026-11-06", until: "2026-11-06" }, "2026-11-05").empty).toBe(true);
  });
});
