import { describe, expect, it } from "vitest";
import { eventFromRow, eventsInRange, parseTimelineInput } from "./timeline";

describe("parseTimelineInput", () => {
  it("accepts a dated, titled event and trims the text", () => {
    expect(parseTimelineInput({ date: "2026-11-05", title: "  Black Friday começou ", description: " oferta de 20% " })).toEqual({
      date: "2026-11-05",
      title: "Black Friday começou",
      description: "oferta de 20%",
    });
    expect(parseTimelineInput({ date: "2026-11-05", title: "x" })?.description).toBe("");
  });

  it("refuses bad dates, empty or long titles and long descriptions", () => {
    expect(parseTimelineInput({ date: "2026-13-40", title: "x" })).toBeNull();
    expect(parseTimelineInput({ date: "05/11/2026", title: "x" })).toBeNull();
    expect(parseTimelineInput({ date: "2026-11-05", title: "   " })).toBeNull();
    expect(parseTimelineInput({ date: "2026-11-05", title: "x".repeat(121) })).toBeNull();
    expect(parseTimelineInput({ date: "2026-11-05", title: "x", description: "y".repeat(1001) })).toBeNull();
    expect(parseTimelineInput(null)).toBeNull();
  });
});

describe("eventsInRange", () => {
  const list = [
    eventFromRow({ id: "1", event_date: "2026-10-30", title: "B", description: null }),
    eventFromRow({ id: "2", event_date: "2026-11-02", title: "Z", description: "d" }),
    eventFromRow({ id: "3", event_date: "2026-11-02", title: "A", description: null }),
    eventFromRow({ id: "4", event_date: "2026-11-10", title: "C", description: null }),
  ];

  it("keeps the events inside the range, both ends included, oldest first", () => {
    expect(eventsInRange(list, "2026-11-02", "2026-11-09").map((e) => e.id)).toEqual(["3", "2"]);
    expect(eventsInRange(list, "2026-10-30", "2026-11-10").map((e) => e.id)).toEqual(["1", "3", "2", "4"]);
  });

  it("is empty when nothing falls in the range", () => {
    expect(eventsInRange(list, "2026-12-01", "2026-12-31")).toEqual([]);
  });
});
