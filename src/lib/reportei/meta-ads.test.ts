import { describe, expect, it } from "vitest";
import { MetaAdsError, campaignFilterParam, chooseEvent, cplOf, dataRows, describeMetaError, eventTotal, grantedAdAccountIds, isGraphNextUrl, mergeConnectionAccounts, parseAdAccounts, parseDayRows, parseInsights, parseInsightsStrict, readActions } from "./meta-ads";

describe("parseAdAccounts", () => {
  it("builds the act_ id from account_id and keeps currency and timezone", () => {
    expect(parseAdAccounts([{ account_id: "123", name: " Aureon ", currency: "BRL", timezone_name: "America/Sao_Paulo", account_status: 1 }])).toEqual([
      { id: "act_123", name: "Aureon", currency: "BRL", timezone: "America/Sao_Paulo", status: 1 },
    ]);
  });

  it("prefers the id Meta returns and falls back to it when there is no name", () => {
    expect(parseAdAccounts([{ id: "act_9", account_id: "9" }])).toEqual([{ id: "act_9", name: "act_9", currency: null, timezone: null, status: null }]);
  });

  it("drops entries with no id at all", () => {
    expect(parseAdAccounts([{ name: "x" }])).toEqual([]);
  });
});

describe("mergeConnectionAccounts", () => {
  const acc = (id: string, name: string) => ({ id, name, currency: "BRL", timezone: null, status: 1 });

  it("lists each account once, under the first connection that sees it, sorted by name", () => {
    const merged = mergeConnectionAccounts([
      { connectionId: "c1", accounts: [acc("act_2", "Beta"), acc("act_1", "Alfa")] },
      { connectionId: "c2", accounts: [acc("act_1", "Alfa"), acc("act_3", "Gama")] },
    ]);
    expect(merged.map((a) => [a.id, a.connectionId])).toEqual([
      ["act_1", "c1"],
      ["act_2", "c1"],
      ["act_3", "c2"],
    ]);
  });

  it("returns an empty list when there are no connections", () => {
    expect(mergeConnectionAccounts([])).toEqual([]);
  });
});

describe("describeMetaError", () => {
  it("joins the code and the message, and tolerates a missing error", () => {
    expect(describeMetaError({ code: 200, message: "Requires ads_read permission" })).toBe("#200 Requires ads_read permission");
    expect(describeMetaError({ message: "x" })).toBe("x");
    expect(describeMetaError(undefined)).toBeUndefined();
  });
});

describe("grantedAdAccountIds", () => {
  it("collects the ad accounts granted under ads_read, as act_ ids, without duplicates", () => {
    expect(
      grantedAdAccountIds({
        data: {
          granular_scopes: [
            { scope: "ads_read", target_ids: ["123", "act_456", 789] },
            { scope: "ads_management", target_ids: ["123"] },
            { scope: "business_management", target_ids: ["999"] },
          ],
        },
      }),
    ).toEqual(["act_123", "act_456", "act_789"]);
  });

  it("ignores ids that are not numeric and a missing granular_scopes", () => {
    expect(grantedAdAccountIds({ data: { granular_scopes: [{ scope: "ads_read", target_ids: ["abc", "12x"] }] } })).toEqual([]);
    expect(grantedAdAccountIds({})).toEqual([]);
  });
});

describe("parseInsights", () => {
  it("turns Meta's string numbers into numbers", () => {
    expect(parseInsights({ spend: "12.34", impressions: "1000", reach: "800", clicks: "25", ctr: "2.5", cpc: "0.49", cpm: "12.34" })).toEqual({
      spend: 12.34,
      impressions: 1000,
      reach: 800,
      clicks: 25,
      ctr: 2.5,
      cpc: 0.49,
      cpm: 12.34,
      leads: 0,
      conversations: 0,
      costPerLead: 0,
    });
  });

  it("returns zeros when there is no row or the values are junk", () => {
    expect(parseInsights(undefined).spend).toBe(0);
    expect(parseInsights({ spend: "abc", impressions: null }).impressions).toBe(0);
  });
});

describe("isGraphNextUrl", () => {
  it("only follows Graph pages over https, without credentials", () => {
    expect(isGraphNextUrl("https://graph.facebook.com/v21.0/act_1/insights?after=abc")).toBe(true);
    expect(isGraphNextUrl("http://graph.facebook.com/v21.0/act_1/insights")).toBe(false);
    expect(isGraphNextUrl("https://evil.example.com/v21.0/act_1/insights")).toBe(false);
    expect(isGraphNextUrl("https://graph.facebook.com.evil.com/v21.0/x")).toBe(false);
    expect(isGraphNextUrl("https://user:pw@graph.facebook.com/v21.0/x")).toBe(false);
    expect(isGraphNextUrl("not a url")).toBe(false);
  });
});

describe("cplOf", () => {
  it("has no value without leads, instead of a zero that looks like a great cost", () => {
    expect(cplOf(100, 8)).toBe(12.5);
    expect(cplOf(100, 0)).toBeNull();
    expect(cplOf(100, null)).toBeNull();
  });
});

describe("dataRows: only a real list is an answer", () => {
  it("accepts an empty list as a valid 'nothing here' and rows that are objects", () => {
    expect(dataRows({ data: [] })).toEqual([]);
    expect(dataRows({ data: [{ spend: "1" }] })).toEqual([{ spend: "1" }]);
  });
  it("rejects a missing, null or non-list data, and rows that are not objects", () => {
    for (const body of [{}, null, undefined, "x", { data: null }, { data: {} }, { data: "no" }, { error: { code: 1 } }]) {
      expect(() => dataRows(body)).toThrow(MetaAdsError);
    }
    expect(() => dataRows({ data: [1] })).toThrow();
    expect(() => dataRows({ data: [[]] })).toThrow();
    expect(() => dataRows({ data: [null] })).toThrow();
  });
  it("the failure is an invalid payload, not a lack of delivery", () => {
    try {
      dataRows({});
    } catch (e) {
      expect((e as MetaAdsError).code).toBe("invalid_payload");
    }
  });
});

describe("readActions", () => {
  it("is null when absent and a typed list when well formed", () => {
    expect(readActions(undefined, "actions")).toBeNull();
    expect(readActions([{ action_type: "lead", value: "3" }], "actions")).toEqual([{ type: "lead", value: 3 }]);
  });
  it("rejects anything else instead of skipping entries", () => {
    expect(() => readActions("lead", "actions")).toThrow();
    expect(() => readActions({}, "actions")).toThrow();
    expect(() => readActions([{ action_type: "lead", value: "x" }], "actions")).toThrow();
    expect(() => readActions([{ action_type: "lead", value: "-1" }], "actions")).toThrow();
    expect(() => readActions([{ value: "1" }], "actions")).toThrow();
    expect(() => readActions([null], "actions")).toThrow();
  });
});

describe("one event for the quantity and the value", () => {
  const actions = readActions([{ action_type: "offsite_conversion.fb_pixel_purchase", value: "7" }, { action_type: "purchase", value: "9" }, { action_type: "omni_purchase", value: "9" }], "actions");
  it("picks the first canonical event the row carries, never a sum", () => {
    expect(chooseEvent(actions, ["purchase", "offsite_conversion.fb_pixel_purchase"])).toBe("purchase");
    expect(eventTotal(actions, "purchase")).toBe(9);
  });
  it("a pinned event is used exactly: if the row does not carry it, there is none (no fallback)", () => {
    expect(chooseEvent(actions, ["offsite_conversion.fb_pixel_purchase"])).toBe("offsite_conversion.fb_pixel_purchase");
    expect(chooseEvent(actions, ["onsite_conversion.something_else"])).toBeNull();
    expect(chooseEvent(null, ["purchase"])).toBeNull();
    expect(eventTotal(actions, null)).toBeNull();
  });
});

describe("parseInsightsStrict", () => {
  const base = { spend: "100", impressions: "1000", clicks: "50" };

  it("no row means nothing was delivered: real zeros, flagged, with no event", () => {
    expect(parseInsightsStrict(undefined)).toMatchObject({ spend: 0, impressions: 0, delivered: false, purchases: null, purchaseValue: null, purchaseEvent: null, leadEvent: null });
  });

  it("rejects a row with broken, negative, non-finite or missing basic numbers, and broken optional ones", () => {
    for (const bad of [{ ...base, spend: "abc" }, { ...base, spend: "" }, { ...base, spend: "-1" }, { ...base, impressions: "Infinity" }, { ...base, clicks: null }, { spend: "1", clicks: "1" }, { ...base, reach: "oops" }, { ...base, ctr: "NaN" }]) {
      expect(() => parseInsightsStrict(bad as Record<string, unknown>)).toThrow(MetaAdsError);
    }
  });

  it("rejects malformed actions instead of reading them as zero", () => {
    expect(() => parseInsightsStrict({ ...base, actions: "lead" })).toThrow();
    expect(() => parseInsightsStrict({ ...base, actions: [{ action_type: "lead", value: "x" }] })).toThrow();
    expect(() => parseInsightsStrict({ ...base, action_values: [{ value: "1" }] })).toThrow();
  });

  it("reads leads and purchases from one event each and keeps which ones", () => {
    const i = parseInsightsStrict({
      ...base,
      actions: [
        { action_type: "lead", value: "8" },
        { action_type: "offsite_conversion.fb_pixel_lead", value: "8" },
        { action_type: "purchase", value: "2" },
        { action_type: "omni_purchase", value: "2" },
      ],
      action_values: [{ action_type: "purchase", value: "450.5" }],
    });
    expect(i).toMatchObject({ delivered: true, leads: 8, leadEvent: "lead", costPerLead: 12.5, purchases: 2, purchaseEvent: "purchase", purchaseValue: 450.5 });
  });

  it("never pairs the quantity of one event with the value of another", () => {
    // The count is of "purchase", but Meta only sent a value for the pixel event: no value, not that one.
    const i = parseInsightsStrict({ ...base, actions: [{ action_type: "purchase", value: "2" }], action_values: [{ action_type: "offsite_conversion.fb_pixel_purchase", value: "999" }] });
    expect(i).toMatchObject({ purchases: 2, purchaseEvent: "purchase", purchaseValue: null });
  });

  it("uses exactly the event pinned for the client", () => {
    const row = { ...base, actions: [{ action_type: "purchase", value: "2" }, { action_type: "omni_purchase", value: "3" }], action_values: [{ action_type: "omni_purchase", value: "300" }, { action_type: "purchase", value: "200" }] };
    expect(parseInsightsStrict(row, { events: { purchase: "omni_purchase" } })).toMatchObject({ purchases: 3, purchaseValue: 300, purchaseEvent: "omni_purchase" });
    expect(parseInsightsStrict(row, { events: { purchase: "something_missing" } })).toMatchObject({ purchases: null, purchaseValue: null, purchaseEvent: null });
  });

  it("keeps the attribution that was asked and what Meta says it applied, unknown when it does not say", () => {
    expect(parseInsightsStrict({ ...base, attribution_setting: "7d_click, 1d_view" }).attribution).toEqual({ requested: null, mode: "meta_default", effective: "7d_click, 1d_view" });
    expect(parseInsightsStrict(base, { attributionWindows: ["1d_click"] }).attribution).toEqual({ requested: ["1d_click"], mode: "explicit", effective: null });
  });
});

describe("campaignFilterParam: a bad filter is refused, never widened", () => {
  it("no filter = the whole account", () => {
    expect(campaignFilterParam(null)).toBeNull();
    expect(campaignFilterParam(undefined)).toBeNull();
  });
  it("a list of ids becomes the filtering parameter, without duplicates", () => {
    expect(JSON.parse(campaignFilterParam(["1", "2", "2"])!)).toEqual([{ field: "campaign.id", operator: "IN", value: ["1", "2"] }]);
  });
  it("refuses an empty list, a non-id, a non-string or a non-list", () => {
    for (const bad of [[], ["abc"], ["1", "x"], ["1; drop"], [1 as unknown as string], "123" as unknown as string[], [""], ["1".repeat(40)]]) {
      expect(() => campaignFilterParam(bad as string[])).toThrow(MetaAdsError);
    }
  });
  it("the failure is an invalid filter, so the account is reported as failed instead of read whole", () => {
    try {
      campaignFilterParam(["abc"]);
    } catch (e) {
      expect((e as MetaAdsError).code).toBe("invalid_filter");
    }
  });
});

describe("parseDayRows", () => {
  it("sorts by date and keeps unknown leads and purchase value as null", () => {
    const out = parseDayRows([
      { date_start: "2026-10-02", spend: "5", actions: [{ action_type: "lead", value: "2" }] },
      { date_start: "2026-10-01", spend: "3" },
    ]);
    expect(out).toEqual([
      { date: "2026-10-01", spend: 3, leads: null, purchaseValue: null },
      { date: "2026-10-02", spend: 5, leads: 2, purchaseValue: null },
    ]);
  });
  it("uses one purchase event for the value and rejects malformed actions", () => {
    const out = parseDayRows([{ date_start: "2026-10-01", spend: "5", actions: [{ action_type: "purchase", value: "1" }], action_values: [{ action_type: "offsite_conversion.fb_pixel_purchase", value: "50" }, { action_type: "purchase", value: "40" }] }]);
    expect(out[0].purchaseValue).toBe(40);
    expect(() => parseDayRows([{ date_start: "2026-10-01", spend: "5", actions: "x" }])).toThrow();
  });

  it("rejects a row without a valid date or spend", () => {
    expect(() => parseDayRows([{ spend: "1" }])).toThrow();
    expect(() => parseDayRows([{ date_start: "2026-10-01", spend: "x" }])).toThrow();
  });
});
