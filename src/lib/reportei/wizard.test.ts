import { describe, expect, it } from "vitest";
import { resolveAnalysis, resolveCompare, resolveWizardPeriod } from "./wizard";

// 2026-11-05 is a Thursday.
const today = "2026-11-05";

describe("resolveWizardPeriod", () => {
  it("covers the presets of Reportei's form", () => {
    expect(resolveWizardPeriod("last_30d", today)).toEqual({ since: "2026-10-07", until: "2026-11-05" });
    expect(resolveWizardPeriod("last_15d", today)).toEqual({ since: "2026-10-22", until: "2026-11-05" });
    expect(resolveWizardPeriod("last_7d", today)).toEqual({ since: "2026-10-30", until: "2026-11-05" });
    expect(resolveWizardPeriod("today", today)).toEqual({ since: "2026-11-05", until: "2026-11-05" });
    expect(resolveWizardPeriod("last_week", today)).toEqual({ since: "2026-10-26", until: "2026-11-01" });
    expect(resolveWizardPeriod("this_month", today)).toEqual({ since: "2026-11-01", until: "2026-11-05" });
    expect(resolveWizardPeriod("last_month", today)).toEqual({ since: "2026-10-01", until: "2026-10-31" });
    expect(resolveWizardPeriod("last_quarter", today)).toEqual({ since: "2026-07-01", until: "2026-09-30" });
  });

  it("handles the year change for the last month and quarter", () => {
    expect(resolveWizardPeriod("last_month", "2027-01-10")).toEqual({ since: "2026-12-01", until: "2026-12-31" });
    expect(resolveWizardPeriod("last_quarter", "2027-02-10")).toEqual({ since: "2026-10-01", until: "2026-12-31" });
  });

  it("last week is the full Monday to Sunday before, also when today is a Monday or a Sunday", () => {
    expect(resolveWizardPeriod("last_week", "2026-11-02")).toEqual({ since: "2026-10-26", until: "2026-11-01" });
    expect(resolveWizardPeriod("last_week", "2026-11-08")).toEqual({ since: "2026-10-26", until: "2026-11-01" });
  });
});

describe("resolveCompare", () => {
  const range = { since: "2026-10-07", until: "2026-11-05" };

  it("compares with the same-length range before, with nothing, or with a custom one", () => {
    expect(resolveCompare("previous", range, today)).toEqual({ since: "2026-09-07", until: "2026-10-06" });
    expect(resolveCompare("none", range, today)).toBeNull();
    expect(resolveCompare({ since: "2026-08-01", until: "2026-08-31" }, range, today)).toEqual({ since: "2026-08-01", until: "2026-08-31" });
  });

  it("refuses an invalid or future custom range and unknown choices", () => {
    expect(resolveCompare({ since: "2026-09-01", until: "2026-08-01" }, range, today)).toBeUndefined();
    expect(resolveCompare({ since: "2026-11-01", until: "2026-12-01" }, range, today)).toBeUndefined();
    expect(resolveCompare("sometimes", range, today)).toBeUndefined();
    expect(resolveCompare(null, range, today)).toBeUndefined();
  });
});

describe("resolveAnalysis", () => {
  it("takes a preset or a valid custom range", () => {
    expect(resolveAnalysis("last_7d", today)).toEqual({ since: "2026-10-30", until: "2026-11-05" });
    expect(resolveAnalysis({ since: "2026-10-01", until: "2026-10-15" }, today)).toEqual({ since: "2026-10-01", until: "2026-10-15" });
  });

  it("refuses the future, backwards ranges and junk", () => {
    expect(resolveAnalysis({ since: "2026-11-01", until: "2026-11-20" }, today)).toBeNull();
    expect(resolveAnalysis({ since: "2026-10-15", until: "2026-10-01" }, today)).toBeNull();
    expect(resolveAnalysis("forever", today)).toBeNull();
    expect(resolveAnalysis(undefined, today)).toBeNull();
  });
});
