// Scheduling rules of the Reportei automations. Pure: every date is a
// YYYY-MM-DD as seen in São Paulo, and "today" is passed in.
//   daily    → due every day
//   weekly   → due every Monday
//   biweekly → due on the 1st and on the 16th
//   monthly  → due on the 1st
// A run is due when the latest scheduled day (on or before today) is newer than
// the last run and not older than the day the automation was created, so a
// missed ping is caught up the next day and a new automation waits for its
// first scheduled day. What each run reports on is the analysis period: by
// default the natural one of the frequency, or any of ANALYSIS_PERIODS.

import { previousRange } from "@/lib/reportei/report";

export const FREQUENCIES = ["daily", "weekly", "biweekly", "monthly"] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export function isFrequency(v: unknown): v is Frequency {
  return typeof v === "string" && (FREQUENCIES as readonly string[]).includes(v);
}

export const ANALYSIS_PERIODS = [
  "previous_month",
  "previous_fortnight",
  "previous_week_mon_sun",
  "previous_week_sun_sat",
  "last_30d",
  "last_15d",
  "last_7d_incl_today",
  "last_7d_until_yesterday",
] as const;
export type AnalysisPeriod = (typeof ANALYSIS_PERIODS)[number];

export function isAnalysisPeriod(v: unknown): v is AnalysisPeriod {
  return typeof v === "string" && (ANALYSIS_PERIODS as readonly string[]).includes(v);
}

export const COMPARE_PERIODS = ["previous", "none"] as const;
export type ComparePeriod = (typeof COMPARE_PERIODS)[number];

export function isComparePeriod(v: unknown): v is ComparePeriod {
  return typeof v === "string" && (COMPARE_PERIODS as readonly string[]).includes(v);
}

const DAY = 24 * 60 * 60 * 1000;
const toDate = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
const toYmd = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (ymd: string, n: number) => toYmd(new Date(toDate(ymd).getTime() + n * DAY));
const lastDayOfMonth = (ymd: string) => toYmd(new Date(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)), 0)));

/** The most recent scheduled day on or before `today`. */
export function lastScheduledDay(frequency: Frequency, today: string): string {
  switch (frequency) {
    case "daily":
      return today;
    case "monthly":
      return `${today.slice(0, 8)}01`;
    case "biweekly":
      return Number(today.slice(8, 10)) >= 16 ? `${today.slice(0, 8)}16` : `${today.slice(0, 8)}01`;
    case "weekly": {
      const weekday = toDate(today).getUTCDay(); // 0 = Sunday
      return addDays(today, -((weekday + 6) % 7));
    }
  }
}

/** The natural analysis period of a frequency, used when none is chosen. */
export function defaultAnalysisPeriod(frequency: Frequency): AnalysisPeriod {
  switch (frequency) {
    case "daily":
      return "last_7d_until_yesterday";
    case "weekly":
      return "previous_week_mon_sun";
    case "biweekly":
      return "previous_fortnight";
    case "monthly":
      return "previous_month";
  }
}

/** The range an analysis period means for a run on `day`. */
export function periodRange(period: AnalysisPeriod, day: string): { since: string; until: string } {
  switch (period) {
    case "previous_month": {
      const until = addDays(`${day.slice(0, 8)}01`, -1); // last day of the previous month
      return { since: `${until.slice(0, 8)}01`, until };
    }
    case "previous_fortnight": {
      if (Number(day.slice(8, 10)) >= 16) return { since: `${day.slice(0, 8)}01`, until: `${day.slice(0, 8)}15` };
      const until = addDays(`${day.slice(0, 8)}01`, -1);
      return { since: `${until.slice(0, 8)}16`, until };
    }
    case "previous_week_mon_sun": {
      const monday = addDays(day, -((toDate(day).getUTCDay() + 6) % 7));
      return { since: addDays(monday, -7), until: addDays(monday, -1) };
    }
    case "previous_week_sun_sat": {
      const sunday = addDays(day, -toDate(day).getUTCDay());
      return { since: addDays(sunday, -7), until: addDays(sunday, -1) };
    }
    case "last_30d":
      return { since: addDays(day, -30), until: addDays(day, -1) };
    case "last_15d":
      return { since: addDays(day, -15), until: addDays(day, -1) };
    case "last_7d_incl_today":
      return { since: addDays(day, -6), until: day };
    case "last_7d_until_yesterday":
      return { since: addDays(day, -7), until: addDays(day, -1) };
  }
}

/** The range a run scheduled on `scheduledDay` reports on: the chosen analysis period, or the frequency's own. */
export function automationRange(frequency: Frequency, scheduledDay: string, period?: AnalysisPeriod | null): { since: string; until: string } {
  return periodRange(period ?? defaultAnalysisPeriod(frequency), scheduledDay);
}

/** True when the range is whole calendar months (first day to last day). */
function isWholeMonths(range: { since: string; until: string }): boolean {
  return range.since.slice(8, 10) === "01" && range.until === lastDayOfMonth(range.until);
}

/**
 * The range right before it, for the comparison. A single calendar month is
 * compared with the month before it (not with the same number of days); anything
 * else with the same number of days that ends the day before.
 */
export function automationCompare(range: { since: string; until: string }): { since: string; until: string } {
  if (isWholeMonths(range) && range.since.slice(0, 7) === range.until.slice(0, 7)) {
    const until = addDays(range.since, -1);
    return { since: `${until.slice(0, 8)}01`, until };
  }
  return previousRange(range.since, range.until);
}

/** The scheduled day to run now, or null when nothing is due. */
export function dueDay(frequency: Frequency, today: string, lastRunOn: string | null, createdOn: string): string | null {
  const day = lastScheduledDay(frequency, today);
  if (day < createdOn) return null;
  if (lastRunOn && lastRunOn >= day) return null;
  return day;
}

const dm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;

const KIND: Record<Frequency, string> = { daily: "diário", weekly: "semanal", biweekly: "quinzenal", monthly: "mensal" };

/** "26/10 a 01/11", or "10/2026" for a whole month. */
export function periodLabel(range: { since: string; until: string }): string {
  return isWholeMonths(range) && range.since.slice(0, 7) === range.until.slice(0, 7)
    ? `${range.since.slice(5, 7)}/${range.since.slice(0, 4)}`
    : `${dm(range.since)} a ${dm(range.until)}`;
}

/**
 * Title of an automatic report: the one the automation was given (with {cliente}
 * and {periodo} filled in), or "Relatório semanal · Aureon · 26/10 a 01/11".
 */
export function automationTitle(frequency: Frequency, clientName: string, range: { since: string; until: string }, custom?: string | null): string {
  const label = periodLabel(range);
  const text = custom?.trim()
    ? custom.trim().replaceAll("{cliente}", clientName).replaceAll("{periodo}", label)
    : `Relatório ${KIND[frequency]} · ${clientName} · ${label}`;
  return text.slice(0, 200);
}

/** The next scheduled day strictly after `today`. */
export function nextScheduledDay(frequency: Frequency, today: string): string {
  switch (frequency) {
    case "daily":
      return addDays(today, 1);
    case "weekly": {
      const weekday = toDate(today).getUTCDay(); // 0 = Sunday
      return addDays(today, (8 - weekday) % 7 || 7);
    }
    case "biweekly":
      return Number(today.slice(8, 10)) < 16 ? `${today.slice(0, 8)}16` : nextMonthFirst(today);
    case "monthly":
      return nextMonthFirst(today);
  }
}

function nextMonthFirst(ymd: string): string {
  return toYmd(new Date(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)), 1)));
}

/** Whole days from `from` to `to` (both YYYY-MM-DD). */
export function daysBetween(from: string, to: string): number {
  return Math.round((toDate(to).getTime() - toDate(from).getTime()) / DAY);
}
