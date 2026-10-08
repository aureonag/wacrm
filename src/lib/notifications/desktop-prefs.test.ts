import { describe, expect, it } from "vitest";
import {
  DEFAULT_DESKTOP_TYPES,
  DEFAULT_PREFS,
  NOTIFICATION_GROUPS,
  isTypeEnabled,
  popupBody,
  typeChecked,
} from "./desktop-prefs";

describe("isTypeEnabled", () => {
  it("important types are on by default, small changes are not", () => {
    expect(isTypeEnabled(DEFAULT_PREFS, "task_mention")).toBe(true);
    expect(isTypeEnabled(DEFAULT_PREFS, "contract_signed")).toBe(true);
    expect(isTypeEnabled(DEFAULT_PREFS, "task_moved")).toBe(false);
    expect(isTypeEnabled(DEFAULT_PREFS, "task_updated")).toBe(false);
  });

  it("the person's choice wins over the default", () => {
    const prefs = { enabled: true, overrides: { task_moved: true, task_mention: false } };
    expect(isTypeEnabled(prefs, "task_moved")).toBe(true);
    expect(isTypeEnabled(prefs, "task_mention")).toBe(false);
  });

  it("the master switch turns everything off", () => {
    const prefs = { enabled: false, overrides: { task_moved: true } };
    expect(isTypeEnabled(prefs, "task_moved")).toBe(false);
    expect(isTypeEnabled(prefs, "task_mention")).toBe(false);
  });
});

describe("typeChecked", () => {
  it("shows the default until the person changes it, regardless of the master switch", () => {
    expect(typeChecked({ enabled: false, overrides: {} }, "task_mention")).toBe(true);
    expect(typeChecked({ enabled: true, overrides: { task_mention: false } }, "task_mention")).toBe(false);
  });
});

describe("groups", () => {
  it("list every notification type exactly once", () => {
    const all = NOTIFICATION_GROUPS.flatMap((g) => g.types);
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(26);
  });
  it("every default type belongs to a group", () => {
    const all = new Set(NOTIFICATION_GROUPS.flatMap((g) => g.types));
    for (const t of DEFAULT_DESKTOP_TYPES) expect(all.has(t)).toBe(true);
  });
});

describe("popupBody", () => {
  it("joins the summary and who did it", () => {
    expect(popupBody({ body: "DAILY MÍDIA" }, "Allan Giro")).toBe("DAILY MÍDIA · por Allan Giro");
    expect(popupBody({ body: "DAILY MÍDIA" })).toBe("DAILY MÍDIA");
    expect(popupBody({}, "Allan Giro")).toBe("por Allan Giro");
    expect(popupBody({})).toBe("");
  });
});
