import { describe, expect, it } from "vitest";
import { projectYear, type ProjectionClient, type ProjectionValue } from "./projection";

const NOW = new Date(2026, 8, 15); // 15 Sep 2026
const active = (id = "c1", ended_at: string | null = null, recurring = true): ProjectionClient => ({
  id,
  status: "active",
  recurring,
  ended_at,
});
const val = (client_id: string, year: number, month: number, amount: number): ProjectionValue => ({ client_id, year, month, amount });

const monthsOf = (map: Map<string, unknown>, id = "c1") =>
  [...map.keys()].filter((k) => k.startsWith(id + ":")).map((k) => Number(k.split(":")[1])).sort((a, b) => a - b);

describe("projectYear", () => {
  it("always returns typed values as-is (not projected)", () => {
    const m = projectYear({ clients: [active()], values: [val("c1", 2026, 3, 500)], year: 2026, now: NOW });
    expect(m.get("c1:3")).toEqual({ amount: 500, projected: false });
  });

  it("carries the last value into the next year until cancelled", () => {
    const values = [val("c1", 2026, 11, 1000), val("c1", 2026, 12, 1200)];
    const m = projectYear({ clients: [active()], values, year: 2027, now: NOW });
    expect(monthsOf(m)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(m.get("c1:1")).toEqual({ amount: 1200, projected: true });
    expect(m.get("c1:12")).toEqual({ amount: 1200, projected: true });
  });

  it("never invents past months: projection starts at the current month", () => {
    const m = projectYear({ clients: [active()], values: [val("c1", 2026, 3, 800)], year: 2026, now: NOW });
    expect(monthsOf(m)).toEqual([3, 9, 10, 11, 12]);
    expect(m.get("c1:5")).toBeUndefined();
    expect(m.get("c1:9")).toEqual({ amount: 800, projected: true });
  });

  it("stops at the month the client ended (inclusive)", () => {
    const m = projectYear({
      clients: [active("c1", "2027-03-20")],
      values: [val("c1", 2026, 12, 1000)],
      year: 2027,
      now: NOW,
    });
    expect(monthsOf(m)).toEqual([1, 2, 3]);
  });

  it("does not project ended clients or a last value of zero", () => {
    const ended: ProjectionClient = { id: "e", status: "ended", recurring: true, ended_at: null };
    const m = projectYear({
      clients: [ended, active("z")],
      values: [val("e", 2026, 12, 900), val("z", 2026, 12, 0)],
      year: 2027,
      now: NOW,
    });
    expect(monthsOf(m, "e")).toEqual([]);
    expect(monthsOf(m, "z")).toEqual([]);
  });

  it("a manual change becomes the new carried value, and a gap between typed months stays a gap", () => {
    const values = [val("c1", 2026, 9, 1000), val("c1", 2026, 11, 1500)];
    const m = projectYear({ clients: [active()], values, year: 2026, now: NOW });
    expect(m.get("c1:10")).toBeUndefined();
    expect(m.get("c1:11")).toEqual({ amount: 1500, projected: false });
    expect(m.get("c1:12")).toEqual({ amount: 1500, projected: true });
  });

  it("never projects a client that is not flagged as recurring (one-off jobs)", () => {
    const m = projectYear({
      clients: [active("c1", null, false)],
      values: [val("c1", 2026, 6, 10000)],
      year: 2026,
      now: NOW,
    });
    expect(monthsOf(m)).toEqual([6]);
  });

  it("clients with no history stay empty", () => {
    const m = projectYear({ clients: [active()], values: [], year: 2027, now: NOW });
    expect(m.size).toBe(0);
  });
});
