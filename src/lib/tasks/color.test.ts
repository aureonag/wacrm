import { describe, expect, it } from "vitest";
import {
  hexToHsv,
  hexToRgb,
  hsvToHex,
  normalizeHex,
  readableTextColor,
  rgbToHex,
  HIGHLIGHT_PRESETS,
} from "./color";

describe("normalizeHex", () => {
  it("accepts 3 and 6 digit forms, with or without #", () => {
    expect(normalizeHex("#fa0")).toBe("#FFAA00");
    expect(normalizeHex("d9d9d9")).toBe("#D9D9D9");
    expect(normalizeHex("  #AbCdEf ")).toBe("#ABCDEF");
  });
  it("rejects anything else (also protects the inline style)", () => {
    expect(normalizeHex("")).toBeNull();
    expect(normalizeHex("#12345")).toBeNull();
    expect(normalizeHex("red")).toBeNull();
    expect(normalizeHex("#fff; background:url(x)")).toBeNull();
    expect(normalizeHex(null)).toBeNull();
    expect(normalizeHex(123)).toBeNull();
  });
});

describe("conversions", () => {
  it("hex <-> rgb", () => {
    expect(hexToRgb("#FF8000")).toEqual({ r: 255, g: 128, b: 0 });
    expect(rgbToHex({ r: 255, g: 128, b: 0 })).toBe("#FF8000");
  });
  it("primary colors map to the expected hue", () => {
    expect(hexToHsv("#FF0000").h).toBe(0);
    expect(Math.round(hexToHsv("#00FF00").h)).toBe(120);
    expect(Math.round(hexToHsv("#0000FF").h)).toBe(240);
  });
  it("round-trips every preset", () => {
    for (const hex of HIGHLIGHT_PRESETS.flat()) expect(hsvToHex(hexToHsv(hex))).toBe(hex);
  });
  it("greys have no saturation", () => {
    const hsv = hexToHsv("#9CA3AF");
    expect(hsv.s).toBeLessThan(0.2);
    expect(hexToHsv("#000000")).toEqual({ h: 0, s: 0, v: 0 });
    expect(hexToHsv("#FFFFFF")).toEqual({ h: 0, s: 0, v: 1 });
  });
});

describe("readableTextColor", () => {
  it("dark text on light fills, white on dark fills", () => {
    expect(readableTextColor("#FFEB3B")).toBe("#111827");
    expect(readableTextColor("#FFFFFF")).toBe("#111827");
    expect(readableTextColor("#000000")).toBe("#FFFFFF");
    expect(readableTextColor("#3B82F6")).toBe("#FFFFFF");
  });
});
