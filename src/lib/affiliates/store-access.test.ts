import { describe, expect, it } from "vitest";
import { can, effectivePermissions, parseOverrides, ROLE_PRESETS, satisfies } from "./store-access";

describe("effectivePermissions", () => {
  it("uses the role preset when there are no overrides", () => {
    const p = effectivePermissions("finance", {});
    expect(can(p, "payments", "edit")).toBe(true);
    expect(can(p, "campaigns", "edit")).toBe(false);
    expect(can(p, "team", "view")).toBe(false);
  });

  it("an override replaces the preset of that module only", () => {
    const p = effectivePermissions("viewer", { payments: ["view"], campaigns: [] });
    expect(can(p, "payments", "view")).toBe(true); // was none
    expect(can(p, "campaigns", "view")).toBe(false); // was view, now removed
    expect(can(p, "reports", "view")).toBe(true); // untouched
  });

  it("edit always includes view and junk is ignored", () => {
    expect(parseOverrides({ campaigns: ["edit"], reports: ["delete", "x"], nope: ["view"] })).toEqual({
      campaigns: ["edit", "view"],
      reports: [],
    });
    expect(parseOverrides("not an object")).toEqual({});
    expect(parseOverrides([1, 2])).toEqual({});
  });

  it("an unknown role never gets more than a viewer", () => {
    // @ts-expect-error deliberately wrong
    const p = effectivePermissions("god", {});
    expect(p).toEqual(ROLE_PRESETS.viewer);
  });
});

describe("satisfies", () => {
  it("lets a viewer read the dashboard but not close a commission", () => {
    const p = effectivePermissions("viewer", {});
    expect(satisfies(p, "any-view")).toBe(true);
    expect(satisfies(p, [["commissions", "edit"]])).toBe(false);
  });

  it("accepts any of the alternatives", () => {
    const p = effectivePermissions("manager", {});
    expect(satisfies(p, [["payments", "edit"], ["reports", "view"]])).toBe(true);
    expect(satisfies(p, [["payments", "edit"], ["reports", "edit"]])).toBe(false);
  });

  it("someone with every module removed cannot even see the dashboard", () => {
    const none = Object.fromEntries(
      ["campaigns", "affiliates", "commissions", "invoices", "payments", "reports", "integrations", "team"].map((m) => [m, []]),
    );
    expect(satisfies(effectivePermissions("owner", none), "any-view")).toBe(false);
  });
});
