import { describe, expect, it } from "vitest";
import { daysLeft, expiryFrom, isExpired, parseShareDays } from "./share";

const now = new Date("2026-11-05T12:00:00Z");

describe("parseShareDays", () => {
  it("accepts the offered choices and null", () => {
    expect(parseShareDays(7)).toBe(7);
    expect(parseShareDays(90)).toBe(90);
    expect(parseShareDays(null)).toBeNull();
  });

  it("refuses anything else", () => {
    expect(parseShareDays(5)).toBeUndefined();
    expect(parseShareDays("7")).toBeUndefined();
    expect(parseShareDays(undefined)).toBeUndefined();
  });
});

describe("expiry", () => {
  it("adds the days, or nothing", () => {
    expect(expiryFrom(7, now)).toBe("2026-11-12T12:00:00.000Z");
    expect(expiryFrom(null, now)).toBeNull();
  });

  it("is expired only when the date has passed", () => {
    expect(isExpired("2026-11-05T11:59:59Z", now)).toBe(true);
    expect(isExpired("2026-11-05T12:00:00Z", now)).toBe(true);
    expect(isExpired("2026-11-06T00:00:00Z", now)).toBe(false);
    expect(isExpired(null, now)).toBe(false);
  });

  it("counts the days left rounding up", () => {
    expect(daysLeft("2026-11-12T12:00:00Z", now)).toBe(7);
    expect(daysLeft("2026-11-12T13:00:00Z", now)).toBe(8);
    expect(daysLeft("2026-11-01T00:00:00Z", now)).toBe(0);
    expect(daysLeft(null, now)).toBeNull();
  });
});
