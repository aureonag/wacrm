import { describe, expect, it } from "vitest";
import { sortTaskIds, type SortableTask } from "./task-sort";

const task = (id: string, over: Partial<SortableTask> = {}): SortableTask => ({
  id,
  title: id,
  created_at: "2026-10-01T10:00:00Z",
  ...over,
});

describe("sortTaskIds", () => {
  it("sorts by due date, soonest first, no date last", () => {
    const tasks = [
      task("a", { due_date: "2026-10-20" }),
      task("b", { due_date: null }),
      task("c", { due_date: "2026-10-05" }),
    ];
    expect(sortTaskIds(tasks, "dueDate")).toEqual(["c", "a", "b"]);
  });

  it("sorts by start date the same way", () => {
    const tasks = [task("a", { start_date: "2026-11-01" }), task("b", { start_date: "2026-10-01" })];
    expect(sortTaskIds(tasks, "startDate")).toEqual(["b", "a"]);
  });

  it("sorts 'created at' newest first", () => {
    const tasks = [
      task("old", { created_at: "2026-09-01T00:00:00Z" }),
      task("new", { created_at: "2026-10-10T00:00:00Z" }),
    ];
    expect(sortTaskIds(tasks, "createdAt")).toEqual(["new", "old"]);
  });

  it("sorts clients and projects A to Z ignoring accents/case, empty last", () => {
    const tasks = [
      task("1", { project: { client_name: "zeta", name: "p" } }),
      task("2", { project: null }),
      task("3", { project: { client_name: "Álamo", name: "p" } }),
    ];
    expect(sortTaskIds(tasks, "client")).toEqual(["3", "1", "2"]);
  });

  it("sorts titles with numbers naturally", () => {
    const tasks = [task("x", { title: "Post 10" }), task("y", { title: "Post 2" })];
    expect(sortTaskIds(tasks, "title")).toEqual(["y", "x"]);
  });

  it("keeps the current order for ties", () => {
    const tasks = [task("a", { due_date: "2026-10-01" }), task("b", { due_date: "2026-10-01" })];
    expect(sortTaskIds(tasks, "dueDate")).toEqual(["a", "b"]);
  });
});
