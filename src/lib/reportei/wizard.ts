// The "Novo relatório" form of Reportei: the periods it offers (last 30 / 15 / 7 days,
// today, last week, this month, last month, last quarter, a custom one) and the three
// ways to compare. Pure; "today" is passed in as a YYYY-MM-DD in São Paulo.

import { isValidRange, isYmd, previousRange } from "@/lib/reportei/report";

export const WIZARD_PERIODS = ["last_30d", "last_15d", "last_7d", "today", "last_week", "this_month", "last_month", "last_quarter"] as const;
export type WizardPeriod = (typeof WIZARD_PERIODS)[number];

export const isWizardPeriod = (v: unknown): v is WizardPeriod => typeof v === "string" && (WIZARD_PERIODS as readonly string[]).includes(v);

export interface DateRange {
  since: string;
  until: string;
}

const DAY = 24 * 60 * 60 * 1000;
const toDate = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
const toYmd = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (ymd: string, n: number) => toYmd(new Date(toDate(ymd).getTime() + n * DAY));

/** The range a period means on `today`. */
export function resolveWizardPeriod(period: WizardPeriod, today: string): DateRange {
  const d = toDate(today);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  switch (period) {
    case "last_30d":
      return { since: addDays(today, -29), until: today };
    case "last_15d":
      return { since: addDays(today, -14), until: today };
    case "last_7d":
      return { since: addDays(today, -6), until: today };
    case "today":
      return { since: today, until: today };
    case "last_week": {
      const monday = addDays(today, -((d.getUTCDay() + 6) % 7));
      return { since: addDays(monday, -7), until: addDays(monday, -1) };
    }
    case "this_month":
      return { since: toYmd(new Date(Date.UTC(y, m, 1))), until: today };
    case "last_month":
      return { since: toYmd(new Date(Date.UTC(y, m - 1, 1))), until: toYmd(new Date(Date.UTC(y, m, 0))) };
    case "last_quarter": {
      const thisQuarter = Math.floor(m / 3) * 3;
      return { since: toYmd(new Date(Date.UTC(y, thisQuarter - 3, 1))), until: toYmd(new Date(Date.UTC(y, thisQuarter, 0))) };
    }
  }
}

export type CompareChoice = "previous" | "none" | DateRange;

/** The comparison range for a choice: the same-length range before, nothing, or a valid custom one. `undefined` when the choice is not valid. */
export function resolveCompare(choice: unknown, range: DateRange, today: string): DateRange | null | undefined {
  if (choice === "previous") return previousRange(range.since, range.until);
  if (choice === "none") return null;
  if (typeof choice === "object" && choice !== null) {
    const { since, until } = choice as Record<string, unknown>;
    if (isYmd(since) && isYmd(until) && since <= until && until <= today) return { since, until };
  }
  return undefined;
}

/** The analysis range from the form: a preset or a custom {since, until} (valid, within a year, not in the future). */
export function resolveAnalysis(input: unknown, today: string): DateRange | null {
  if (isWizardPeriod(input)) return resolveWizardPeriod(input, today);
  if (typeof input === "object" && input !== null) {
    const { since, until } = input as Record<string, unknown>;
    if (isValidRange(since, until, today)) return { since: since as string, until: until as string };
  }
  return null;
}
