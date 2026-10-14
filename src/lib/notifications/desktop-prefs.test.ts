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
  it("everything that happens on a task is on by default", () => {
    for (const type of ["task_mention", "contract_signed", "task_moved", "task_updated", "task_transferred", "due_date_changed"] as const) {
      expect(isTypeEnabled(DEFAULT_PREFS, type)).toBe(true);
    }
  });

  it("the person's choice wins over the default", () => {
    const prefs = { enabled: true, overrides: { task_moved: false, task_mention: false } };
    expect(isTypeEnabled(prefs, "task_moved")).toBe(false);
    expect(isTypeEnabled(prefs, "task_mention")).toBe(false);
    expect(isTypeEnabled(prefs, "task_updated")).toBe(true);
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
