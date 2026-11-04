import { describe, expect, it } from "vitest";
import { BadInput, parseAffiliateInput, parseCouponCode } from "./campaigns";

describe("parseCouponCode", () => {
  it("normalizes to uppercase and trims", () => {
    expect(parseCouponCode("  nicoll10 ")).toBe("NICOLL10");
    expect(parseCouponCode("abc")).toBe("ABC");
    expect(parseCouponCode("A".repeat(30))).toBe("A".repeat(30));
  });

  it("refuses what the store cannot take", () => {
    for (const bad of ["", "ab", "A".repeat(31), "NICOLL 10", "NICOLL-10", "NICOLLÉ10", "NICOLL_10", null, undefined, 123]) {
      expect(() => parseCouponCode(bad)).toThrow(BadInput);
    }
  });

  it("is the same rule the new-affiliate form uses", () => {
    const base = { name: "Ana", email: "ana@example.com", campaign_id: "9fc80160-0df8-4972-8764-f6174654a9f6" };
    expect(parseAffiliateInput({ ...base, code: "ana10" }).code).toBe("ANA10");
    expect(() => parseAffiliateInput({ ...base, code: "a b" })).toThrow(BadInput);
  });
});
