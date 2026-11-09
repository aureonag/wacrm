import { describe, expect, it } from "vitest";
import { attributionLabel, parseAttributionWindows, parseEventType } from "./event-config";

describe("parseEventType", () => {
  it("accepts well formed event types and treats null or empty as the canonical ones", () => {
    expect(parseEventType("offsite_conversion.fb_pixel_purchase")).toBe("offsite_conversion.fb_pixel_purchase");
    expect(parseEventType(" lead ")).toBe("lead");
    expect(parseEventType(null)).toBeNull();
    expect(parseEventType("")).toBeNull();
  });
  it("refuses anything else", () => {
    for (const bad of [5, {}, [], "a b", "x;y", "x".repeat(101), "<script>"]) expect(parseEventType(bad)).toBeUndefined();
  });
});

describe("parseAttributionWindows", () => {
  it("accepts known windows (deduplicated) and null for Meta's default", () => {
    expect(parseAttributionWindows(["7d_click", "1d_view", "7d_click"])).toEqual(["7d_click", "1d_view"]);
    expect(parseAttributionWindows(null)).toBeNull();
  });
  it("refuses an empty list, unknown windows, too many, or non-lists", () => {
    for (const bad of [[], ["forever"], ["1d_click", "7d_click", "28d_click", "1d_view", "7d_view"], "7d_click", [5], undefined]) expect(parseAttributionWindows(bad)).toBeUndefined();
  });
});

describe("attributionLabel", () => {
  it("says what was asked and what Meta applied, and 'unknown' when it did not say", () => {
    expect(attributionLabel({ requested: null, mode: "meta_default", effective: "7d_click, 1d_view" })).toContain("7d_click, 1d_view");
    expect(attributionLabel({ requested: null, mode: "meta_default", effective: null })).toContain("não informou");
    expect(attributionLabel({ requested: ["1d_click"], mode: "explicit", effective: null })).toContain("pedida: 1d_click");
    expect(attributionLabel(undefined)).toContain("não registrada");
  });
});
