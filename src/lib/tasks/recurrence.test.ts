import { describe, expect, it } from "vitest";
import { computeInitialNextRunAt } from "./recurrence";

describe("computeInitialNextRunAt", () => {
  describe("weekly", () => {
    it("lands on the same weekday next week when created on that weekday", () => {
      // 2026-01-01 is a Thursday.
      const from = new Date("2026-01-01T00:00:00Z");
      expect(computeInitialNextRunAt({ ruleType: "weekly", weekday: 4 }, from)).toBe("2026-01-08");
    });

    it("lands on the next occurrence of an earlier-in-the-week weekday", () => {
      const from = new Date("2026-01-01T00:00:00Z"); // Thursday
      expect(computeInitialNextRunAt({ ruleType: "weekly", weekday: 1 }, from)).toBe("2026-01-05"); // Monday
    });
  });

  describe("monthly_day", () => {
    it("uses the given day of the following month", () => {
      const from = new Date("2026-01-15T00:00:00Z");
      expect(computeInitialNextRunAt({ ruleType: "monthly_day", dayOfMonth: 15 }, from)).toBe("2026-02-15");
    });

    it("clamps to the last day of a shorter following month", () => {
      const from = new Date("2026-01-15T00:00:00Z");
      expect(computeInitialNextRunAt({ ruleType: "monthly_day", dayOfMonth: 31 }, from)).toBe("2026-02-28");
    });
  });

  describe("monthly_first_business_day", () => {
    it("uses the 1st when it already falls on a weekday", () => {
      const from = new Date("2026-04-15T00:00:00Z"); // next month (May) starts on a Friday
      expect(computeInitialNextRunAt({ ruleType: "monthly_first_business_day" }, from)).toBe("2026-05-01");
    });

    it("skips a single weekend day (month starting on Sunday)", () => {
      const from = new Date("2026-01-15T00:00:00Z"); // February 2026 starts on a Sunday
      expect(computeInitialNextRunAt({ ruleType: "monthly_first_business_day" }, from)).toBe("2026-02-02");
    });

    it("skips a full weekend (month starting on Saturday)", () => {
      const from = new Date("2026-07-15T00:00:00Z"); // August 2026 starts on a Saturday
      expect(computeInitialNextRunAt({ ruleType: "monthly_first_business_day" }, from)).toBe("2026-08-03");
    });
  });
});
