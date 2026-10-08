import { describe, expect, it } from "vitest";
import { formatClockSeconds, summarizeTaskTime, type CardTimeEntry } from "./timesheet";

const T0 = new Date("2026-10-08T12:00:00Z").getTime();
const iso = (offsetSeconds: number) => new Date(T0 + offsetSeconds * 1000).toISOString();

describe("formatClockSeconds", () => {
  it("pads to HH:MM:SS", () => {
    expect(formatClockSeconds(0)).toBe("00:00:00");
    expect(formatClockSeconds(65)).toBe("00:01:05");
    expect(formatClockSeconds(4500)).toBe("01:15:00");
    expect(formatClockSeconds(360000)).toBe("100:00:00");
  });
  it("never goes negative", () => {
    expect(formatClockSeconds(-5)).toBe("00:00:00");
  });
});

describe("summarizeTaskTime", () => {
  it("is empty without entries", () => {
    expect(summarizeTaskTime(undefined, T0)).toEqual({ totalSeconds: 0, people: [], running: false });
  });

  it("keeps each person's time apart and sums the total", () => {
    const entries: CardTimeEntry[] = [
      { user_id: "a", name: "Mídia", started_at: iso(0), ended_at: iso(600) },
      { user_id: "a", name: "Mídia", started_at: iso(1000), ended_at: iso(1300) },
      { user_id: "b", name: "Social", started_at: iso(0), ended_at: iso(60) },
    ];
    const s = summarizeTaskTime(entries, T0 + 5000_000);
    expect(s.people.map((p) => [p.name, p.seconds])).toEqual([
      ["Mídia", 900],
      ["Social", 60],
    ]);
    expect(s.totalSeconds).toBe(960);
    expect(s.running).toBe(false);
  });

  it("counts an open entry up to now and flags who is running", () => {
    const entries: CardTimeEntry[] = [
      { user_id: "a", name: "Mídia", started_at: iso(0), ended_at: iso(100) },
      { user_id: "a", name: "Mídia", started_at: iso(200), ended_at: null },
    ];
    const s = summarizeTaskTime(entries, T0 + 260_000);
    expect(s.people[0]).toMatchObject({ userId: "a", seconds: 160, running: true });
    expect(s.running).toBe(true);
  });

  it("a paused task keeps its accumulated time", () => {
    const entries: CardTimeEntry[] = [{ user_id: "a", name: "A", started_at: iso(0), ended_at: iso(90) }];
    expect(summarizeTaskTime(entries, T0 + 10_000_000).totalSeconds).toBe(90);
  });

  it("groups entries without a user together", () => {
    const entries: CardTimeEntry[] = [
      { user_id: null, started_at: iso(0), ended_at: iso(30) },
      { user_id: null, started_at: iso(40), ended_at: iso(70) },
    ];
    const s = summarizeTaskTime(entries, T0);
    expect(s.people).toHaveLength(1);
    expect(s.totalSeconds).toBe(60);
  });
});
