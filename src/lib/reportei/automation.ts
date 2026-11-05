// Scheduling rules of the Reportei automations. Pure: every date is a
// YYYY-MM-DD as seen in São Paulo, and "today" is passed in.
//   weekly  → due every Monday, covers the 7 full days before it (Mon–Sun)
//   monthly → due on the 1st, covers the whole previous month
// A run is due when the latest scheduled day (on or before today) is newer than
// the last run and not older than the day the automation was created, so a
// missed ping is caught up the next day and a new automation waits for its
// first scheduled day.

import { previousRange } from "@/lib/reportei/report";

export const FREQUENCIES = ["weekly", "monthly"] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export function isFrequency(v: unknown): v is Frequency {
  return typeof v === "string" && (FREQUENCIES as readonly string[]).includes(v);
}

const DAY = 24 * 60 * 60 * 1000;
const toDate = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
const toYmd = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (ymd: string, n: number) => toYmd(new Date(toDate(ymd).getTime() + n * DAY));

/** The most recent scheduled day on or before `today`. */
export function lastScheduledDay(frequency: Frequency, today: string): string {
  if (frequency === "monthly") return `${today.slice(0, 8)}01`;
  const weekday = toDate(today).getUTCDay(); // 0 = Sunday
  return addDays(today, -((weekday + 6) % 7));
}

/** The range a run scheduled on `scheduledDay` reports on. */
export function automationRange(frequency: Frequency, scheduledDay: string): { since: string; until: string } {
  if (frequency === "weekly") return { since: addDays(scheduledDay, -7), until: addDays(scheduledDay, -1) };
  const until = addDays(scheduledDay, -1); // last day of the previous month
  return { since: `${until.slice(0, 8)}01`, until };
}

/** The range of the same kind right before it, for the comparison. A month is compared with the month before it, not with N days. */
export function automationCompare(frequency: Frequency, range: { since: string; until: string }): { since: string; until: string } {
  if (frequency === "weekly") return previousRange(range.since, range.until);
  const until = addDays(range.since, -1);
  return { since: `${until.slice(0, 8)}01`, until };
}

/** The scheduled day to run now, or null when nothing is due. */
export function dueDay(frequency: Frequency, today: string, lastRunOn: string | null, createdOn: string): string | null {
  const day = lastScheduledDay(frequency, today);
  if (day < createdOn) return null;
  if (lastRunOn && lastRunOn >= day) return null;
  return day;
}

const dm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;

/** Title of an automatic report. */
export function automationTitle(frequency: Frequency, clientName: string, range: { since: string; until: string }): string {
  const label = frequency === "weekly" ? `${dm(range.since)} a ${dm(range.until)}` : `${range.since.slice(5, 7)}/${range.since.slice(0, 4)}`;
  return `${frequency === "weekly" ? "Relatório semanal" : "Relatório mensal"} · ${clientName} · ${label}`.slice(0, 200);
}
