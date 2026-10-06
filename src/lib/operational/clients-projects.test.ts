import { describe, expect, it } from "vitest";
import { countTasks, parseClientInput, parseProjectInput, ValidationError } from "./clients-projects";

describe("parseClientInput", () => {
  it("requires a name and defaults to active", () => {
    expect(parseClientInput({ name: "  Pink Heels ", code: " 00175 " })).toEqual({
      name: "Pink Heels",
      code: "00175",
      status: "active",
      notes: null,
    });
    expect(() => parseClientInput({ name: "  " })).toThrow(ValidationError);
  });

  it("an update only touches the keys that were sent", () => {
    expect(parseClientInput({ status: "inactive" }, true)).toEqual({ status: "inactive" });
    expect(() => parseClientInput({ status: "gone" }, true)).toThrow(ValidationError);
  });
});

describe("parseProjectInput", () => {
  it("validates dates and their order", () => {
    expect(parseProjectInput({ name: "Tráfego", start_date: "2026-10-01", due_date: "2026-10-31" })).toMatchObject({
      name: "Tráfego",
      status: "active",
    });
    expect(() => parseProjectInput({ name: "X", start_date: "2026-10-10", due_date: "2026-10-01" })).toThrow(ValidationError);
    expect(() => parseProjectInput({ name: "X", due_date: "31/10/2026" })).toThrow(ValidationError);
  });

  it("only active or archived", () => {
    expect(() => parseProjectInput({ status: "paused" }, true)).toThrow(ValidationError);
    expect(parseProjectInput({ status: "archived" }, true)).toEqual({ status: "archived" });
  });
});

describe("countTasks", () => {
  it("counts open, done and overdue per key", () => {
    const m = countTasks(
      [
        { key: "p1", status: "done", due_date: "2026-01-01" },
        { key: "p1", status: "open", due_date: "2026-10-01" },
        { key: "p1", status: "open", due_date: "2026-12-01" },
        { key: "p1", status: "open", due_date: null },
        { key: "p2", status: "open", due_date: "2026-09-30" },
      ],
      "2026-10-06",
    );
    expect(m.get("p1")).toEqual({ total: 4, open: 3, done: 1, overdue: 1 });
    expect(m.get("p2")).toEqual({ total: 1, open: 1, done: 0, overdue: 1 });
    expect(m.get("p3")).toBeUndefined();
  });
});
