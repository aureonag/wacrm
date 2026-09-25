import { describe, expect, it } from "vitest";
import type { Task } from "@/types";
import { formatTaskCode } from "./code";
import { matchesTaskQuery } from "./search";

const task = {
  id: "1",
  title: "Criar banner da Páscoa",
  task_number: 42,
  contact: { name: "Quality Vacuum" },
  assignee: { full_name: "Maria Souza" },
  tags: [{ label: "Urgente cliente" }],
} as unknown as Task;

describe("task code", () => {
  it("pads to four digits", () => {
    expect(formatTaskCode(42)).toBe("T-0042");
    expect(formatTaskCode(12345)).toBe("T-12345");
    expect(formatTaskCode(null)).toBeNull();
  });
});

describe("matchesTaskQuery", () => {
  it("matches everything when empty", () => expect(matchesTaskQuery(task, "  ")).toBe(true));
  it("matches title ignoring accents and case", () => expect(matchesTaskQuery(task, "pascoa")).toBe(true));
  it("matches code with and without prefix", () => {
    expect(matchesTaskQuery(task, "T-0042")).toBe(true);
    expect(matchesTaskQuery(task, "42")).toBe(true);
  });
  it("matches client, assignee and tag", () => {
    expect(matchesTaskQuery(task, "quality")).toBe(true);
    expect(matchesTaskQuery(task, "maria")).toBe(true);
    expect(matchesTaskQuery(task, "urgente")).toBe(true);
  });
  it("requires every word", () => {
    expect(matchesTaskQuery(task, "banner quality")).toBe(true);
    expect(matchesTaskQuery(task, "banner xyz")).toBe(false);
  });
});
