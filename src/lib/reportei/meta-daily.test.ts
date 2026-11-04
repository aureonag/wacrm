import { describe, expect, it } from "vitest";
import { parseDaily } from "./meta-ads";

describe("parseDaily", () => {
  it("turns string rows into sorted numeric points", () => {
    const out = parseDaily([
      { date_start: "2026-10-02", spend: "1.50", impressions: "100", reach: "80", clicks: "4" },
      { date_start: "2026-10-01", spend: "2", impressions: "50", reach: "40", clicks: "1" },
    ]);
    expect(out).toEqual([
      { date: "2026-10-01", spend: 2, impressions: 50, reach: 40, clicks: 1 },
      { date: "2026-10-02", spend: 1.5, impressions: 100, reach: 80, clicks: 4 },
    ]);
  });

  it("drops rows without a valid date and handles no rows", () => {
    expect(parseDaily([{ spend: "1" }, { date_start: "oops" }])).toEqual([]);
    expect(parseDaily(undefined)).toEqual([]);
  });
});
