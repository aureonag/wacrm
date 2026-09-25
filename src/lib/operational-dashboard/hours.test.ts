import { describe, expect, it } from "vitest";
import { buildHoursSeries, shiftAnchor, startOfWeek, toLocalIso } from "./hours";

const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).toISOString();

describe("buildHoursSeries", () => {
  it("builds 7 bars Monday..Sunday for a week", () => {
    const s = buildHoursSeries([], "week", new Date(2026, 8, 24)); // Thu 24/09/2026
    expect(s.bars).toHaveLength(7);
    expect(s.start).toBe("2026-09-21");
    expect(s.end).toBe("2026-09-27");
  });

  it("builds one bar per day of the month", () => {
    expect(buildHoursSeries([], "month", new Date(2026, 1, 10)).bars).toHaveLength(28);
    expect(buildHoursSeries([], "month", new Date(2026, 8, 1)).bars).toHaveLength(30);
  });

  it("sums entries per day", () => {
    const s = buildHoursSeries(
      [
        { started_at: local(2026, 9, 22, 9), ended_at: local(2026, 9, 22, 11) },
        { started_at: local(2026, 9, 22, 14), ended_at: local(2026, 9, 22, 14, 30) },
      ],
      "week",
      new Date(2026, 8, 24),
    );
    expect(s.bars.find((b) => b.date === "2026-09-22")?.minutes).toBe(150);
    expect(s.totalMinutes).toBe(150);
  });

  it("splits an entry that crosses midnight", () => {
    const s = buildHoursSeries(
      [{ started_at: local(2026, 9, 22, 23), ended_at: local(2026, 9, 23, 1) }],
      "week",
      new Date(2026, 8, 24),
    );
    expect(s.bars.find((b) => b.date === "2026-09-22")?.minutes).toBe(60);
    expect(s.bars.find((b) => b.date === "2026-09-23")?.minutes).toBe(60);
  });

  it("ignores entries outside the range and clips those that straddle it", () => {
    const s = buildHoursSeries(
      [
        { started_at: local(2026, 8, 1, 9), ended_at: local(2026, 8, 1, 10) },
        { started_at: local(2026, 8, 31, 23), ended_at: local(2026, 9, 1, 1) },
      ],
      "month",
      new Date(2026, 8, 15),
    );
    expect(s.totalMinutes).toBe(60);
    expect(s.bars[0].minutes).toBe(60);
  });

  it("counts a running timer up to now", () => {
    const now = new Date(2026, 8, 24, 10, 0);
    const s = buildHoursSeries([{ started_at: local(2026, 9, 24, 9) }], "week", now, now);
    expect(s.totalMinutes).toBe(60);
  });
});

describe("navigation helpers", () => {
  it("finds the Monday of a week, including Sundays", () => {
    expect(toLocalIso(startOfWeek(new Date(2026, 8, 27)))).toBe("2026-09-21");
    expect(toLocalIso(startOfWeek(new Date(2026, 8, 21)))).toBe("2026-09-21");
  });
  it("shifts by week and by month", () => {
    expect(toLocalIso(shiftAnchor(new Date(2026, 8, 24), "week", -1))).toBe("2026-09-17");
    expect(toLocalIso(shiftAnchor(new Date(2026, 0, 31), "month", 1))).toBe("2026-02-01");
  });
});
