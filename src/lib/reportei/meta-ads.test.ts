import { describe, expect, it } from "vitest";
import { parseAdAccounts } from "./meta-ads";

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
