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

  it("rejects a row without a valid date or with broken numbers, and handles no rows", () => {
    expect(() => parseDaily([{ spend: "1" }])).toThrow();
    expect(() => parseDaily([{ date_start: "oops", spend: "1", impressions: "1", clicks: "1" }])).toThrow();
    expect(() => parseDaily([{ date_start: "2026-10-01", spend: "abc", impressions: "1", clicks: "1" }])).toThrow();
    expect(parseDaily(undefined)).toEqual([]);
  });
});

import { actionTotal, parseCampaigns, parseInsights } from "./meta-ads";

describe("result metrics", () => {
  it("reads leads and conversations from Meta's actions and derives the cost per lead", () => {
    const i = parseInsights({
      spend: "100",
      impressions: "1000",
      clicks: "50",
      actions: [
        { action_type: "link_click", value: "40" },
        { action_type: "lead", value: "8" },
        { action_type: "onsite_conversion.messaging_conversation_started_7d", value: "5" },
      ],
    });
    expect(i.leads).toBe(8);
    expect(i.conversations).toBe(5);
    expect(i.costPerLead).toBe(12.5);
  });

  it("is zero without actions", () => {
    expect(parseInsights({ spend: "10" })).toMatchObject({ leads: 0, conversations: 0, costPerLead: 0 });
    expect(actionTotal(undefined, "lead")).toBe(0);
    expect(actionTotal([{ action_type: "lead", value: "x" }], "lead")).toBe(0);
  });
});

describe("parseCampaigns", () => {
  it("keeps numeric ids and falls back to the id as the name", () => {
    expect(parseCampaigns([{ id: "123", name: " Black Friday ", effective_status: "ACTIVE" }, { id: "456" }, { id: "abc", name: "x" }, { name: "no id" }])).toEqual([
      { id: "123", name: "Black Friday", status: "ACTIVE" },
      { id: "456", name: "456", status: "" },
    ]);
    expect(parseCampaigns(undefined)).toEqual([]);
  });
});
