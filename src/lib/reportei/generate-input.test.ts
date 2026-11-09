import { describe, expect, it } from "vitest";
import { parseIntegrations } from "./generate-input";

const meta = (over: Record<string, unknown> = {}) => ({ network: "meta_ads", account: "Conta", accountId: "act_123", ...over });

describe("parseIntegrations", () => {
  it("accepts accounts by id with or without a campaign choice", () => {
    expect(parseIntegrations([meta(), meta({ accountId: "act_9", campaigns: ["1", "2", "2"] })])).toEqual([
      { network: "meta_ads", account: "Conta", accountId: "act_123", campaigns: null },
      { network: "meta_ads", account: "Conta", accountId: "act_9", campaigns: ["1", "2"] },
    ]);
  });

  it("the name is only a label: two accounts with the same name stay distinct by id", () => {
    const out = parseIntegrations([meta({ account: "Mesma", accountId: "act_1" }), meta({ account: "Mesma", accountId: "act_2" })]);
    expect(out?.map((i) => i.accountId)).toEqual(["act_1", "act_2"]);
  });

  it("an id that is not an ad account id makes the request invalid", () => {
    for (const bad of ["123", "act_", "act_12x", "ACT_1", 5, {}, "act_" + "1".repeat(40)]) expect(parseIntegrations([meta({ accountId: bad })])).toBeNull();
  });

  it("a bad campaign filter makes the request invalid instead of becoming the whole account", () => {
    for (const bad of [[], ["abc"], ["1", "x"], [1], "12", {}, ["1; drop"], [""], Array.from({ length: 501 }, (_, i) => String(i + 1))]) {
      expect(parseIntegrations([meta({ campaigns: bad })])).toBeNull();
    }
  });

  it("null or absent campaigns mean the whole account", () => {
    expect(parseIntegrations([meta({ campaigns: null })])?.[0].campaigns).toBeNull();
    expect(parseIntegrations([meta()])?.[0].campaigns).toBeNull();
  });

  it("rejects an empty list, unknown networks and missing labels", () => {
    expect(parseIntegrations([])).toBeNull();
    expect(parseIntegrations("x")).toBeNull();
    expect(parseIntegrations([{ network: "nope", account: "A" }])).toBeNull();
    expect(parseIntegrations([{ network: "meta_ads" }])).toBeNull();
  });
});
