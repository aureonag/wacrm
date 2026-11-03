import { describe, expect, it } from "vitest";
import { describeMetaError, mergeConnectionAccounts, parseAdAccounts } from "./meta-ads";

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
