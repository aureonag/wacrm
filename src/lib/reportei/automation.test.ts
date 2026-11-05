import { describe, expect, it } from "vitest";
import { automationCompare, automationRange, automationTitle, dueDay, lastScheduledDay } from "./automation";

describe("scheduled days", () => {
  it("weekly: the latest Monday on or before today", () => {
    expect(lastScheduledDay("weekly", "2026-11-04")).toBe("2026-11-02"); // Wednesday
    expect(lastScheduledDay("weekly", "2026-11-02")).toBe("2026-11-02"); // Monday
    expect(lastScheduledDay("weekly", "2026-11-08")).toBe("2026-11-02"); // Sunday
  });
  it("monthly: the 1st of the current month", () => {
    expect(lastScheduledDay("monthly", "2026-11-04")).toBe("2026-11-01");
    expect(lastScheduledDay("monthly", "2026-12-31")).toBe("2026-12-01");
  });
});

describe("ranges", () => {
  it("weekly covers Monday–Sunday before the run, compared with the week before", () => {
    const r = automationRange("weekly", "2026-11-02");
    expect(r).toEqual({ since: "2026-10-26", until: "2026-11-01" });
    expect(automationCompare("weekly", r)).toEqual({ since: "2026-10-19", until: "2026-10-25" });
  });
  it("monthly covers the previous month, compared with the month before it", () => {
    const r = automationRange("monthly", "2026-03-01");
    expect(r).toEqual({ since: "2026-02-01", until: "2026-02-28" });
    expect(automationCompare("monthly", r)).toEqual({ since: "2026-01-01", until: "2026-01-31" });
  });
  it("monthly handles the year change", () => {
    const r = automationRange("monthly", "2027-01-01");
    expect(r).toEqual({ since: "2026-12-01", until: "2026-12-31" });
    expect(automationCompare("monthly", r)).toEqual({ since: "2026-11-01", until: "2026-11-30" });
  });
});

describe("dueDay", () => {
  it("runs once per scheduled day", () => {
    expect(dueDay("weekly", "2026-11-02", null, "2026-10-01")).toBe("2026-11-02");
    expect(dueDay("weekly", "2026-11-03", "2026-11-02", "2026-10-01")).toBeNull();
  });
  it("catches up a missed day", () => {
    expect(dueDay("weekly", "2026-11-05", "2026-10-26", "2026-10-01")).toBe("2026-11-02");
  });
  it("a new automation waits for its first scheduled day", () => {
    expect(dueDay("weekly", "2026-11-04", null, "2026-11-04")).toBeNull();
    expect(dueDay("monthly", "2026-11-20", null, "2026-11-20")).toBeNull();
    expect(dueDay("monthly", "2026-12-01", null, "2026-11-20")).toBe("2026-12-01");
  });
});

describe("automationTitle", () => {
  it("names the period", () => {
    expect(automationTitle("weekly", "Aureon", { since: "2026-10-26", until: "2026-11-01" })).toBe("Relatório semanal · Aureon · 26/10 a 01/11");
    expect(automationTitle("monthly", "Aureon", { since: "2026-10-01", until: "2026-10-31" })).toBe("Relatório mensal · Aureon · 10/2026");
  });
});
