import { describe, expect, it } from "vitest";
import { DEFAULT_OPTIONS, effectiveOptions, parseName, parseOptions, templateFromRow } from "./template";

describe("parseOptions", () => {
  it("keeps the canonical order and drops unknown metrics", () => {
    const o = parseOptions({ metrics: ["clicks", "spend", "nope"], chart: true, chartMetrics: ["clicks", "spend"], intro: "  oi  " });
    expect(o).toEqual({ metrics: ["spend", "clicks"], chart: true, chartMetrics: ["spend", "clicks"], intro: "oi" });
  });

  it("needs at least one metric", () => {
    expect(parseOptions({ metrics: [], chart: false })).toBeNull();
    expect(parseOptions({ metrics: ["bogus"], chart: false })).toBeNull();
    expect(parseOptions(null)).toBeNull();
  });

  it("needs a chart metric when the chart is on, and drops them when off", () => {
    expect(parseOptions({ metrics: ["spend"], chart: true, chartMetrics: [] })).toBeNull();
    expect(parseOptions({ metrics: ["spend"], chart: false, chartMetrics: ["spend"] })?.chartMetrics).toEqual([]);
  });

  it("refuses an intro over the limit", () => {
    expect(parseOptions({ metrics: ["spend"], chart: false, intro: "x".repeat(1001) })).toBeNull();
  });
});

describe("parseName", () => {
  it("trims and bounds the name", () => {
    expect(parseName("  Completo ")).toBe("Completo");
    expect(parseName("   ")).toBeNull();
    expect(parseName("x".repeat(81))).toBeNull();
    expect(parseName(3)).toBeNull();
  });
});

describe("effectiveOptions", () => {
  it("shows everything for reports saved before templates", () => {
    expect(effectiveOptions(undefined)).toBe(DEFAULT_OPTIONS);
  });

  it("uses the report's own copy", () => {
    const o = effectiveOptions({ metrics: ["cpc", "spend"], chart: false, chartMetrics: [], intro: "x" });
    expect(o.metrics).toEqual(["spend", "cpc"]);
    expect(o.chart).toBe(false);
    expect(o.intro).toBe("x");
  });

  it("falls back to defaults for unusable lists", () => {
    expect(effectiveOptions({ metrics: [] }).metrics).toEqual(DEFAULT_OPTIONS.metrics);
  });
});

describe("templateFromRow", () => {
  it("maps database columns", () => {
    const t = templateFromRow({ id: "1", name: "A", metrics: ["spend"], chart: true, chart_metrics: ["clicks"], compare: false, intro: null });
    expect(t).toMatchObject({ id: "1", name: "A", compare: false, metrics: ["spend"], chartMetrics: ["clicks"], intro: "" });
  });
});
