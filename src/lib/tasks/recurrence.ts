// Pure helpers for the Recurrence feature (Etapa 2, Fase 5). Deliberately
// simple (no RFC 5545) per the spec: weekly, monthly on a fixed day, or
// monthly on the first business day. The database owns *advancing*
// next_run_at on each firing (see next_recurrence_date() in
// 064_task_recurrence.sql) — this module only computes the *first*
// occurrence when a rule is created, so it's the one place both the UI
// preview and the API route need to agree on, and it's testable without
// a database.

export type RecurrenceRuleType = "weekly" | "monthly_day" | "monthly_first_business_day";

export interface RecurrenceInput {
  ruleType: RecurrenceRuleType;
  /** 0 = Sunday .. 6 = Saturday. Required (and only meaningful) for "weekly". */
  weekday?: number | null;
  /** 1..31, clamped to the target month's last day. Required for "monthly_day". */
  dayOfMonth?: number | null;
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function isWeekend(d: Date): boolean {
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

/** First occurrence date ("YYYY-MM-DD") for a newly created rule, always
 *  strictly after `from` (defaults to today) — a rule created today for
 *  today's weekday fires next week, not today. */
export function computeInitialNextRunAt(input: RecurrenceInput, from: Date = new Date()): string {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));

  if (input.ruleType === "weekly") {
    const target = input.weekday ?? d.getUTCDay();
    let delta = (target - d.getUTCDay() + 7) % 7;
    if (delta === 0) delta = 7;
    d.setUTCDate(d.getUTCDate() + delta);
    return toISODate(d);
  }

  const nextMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));

  if (input.ruleType === "monthly_day") {
    const day = input.dayOfMonth ?? 1;
    const lastDay = new Date(Date.UTC(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth() + 1, 0)).getUTCDate();
    nextMonth.setUTCDate(Math.min(day, lastDay));
    return toISODate(nextMonth);
  }

  // monthly_first_business_day
  while (isWeekend(nextMonth)) nextMonth.setUTCDate(nextMonth.getUTCDate() + 1);
  return toISODate(nextMonth);
}
