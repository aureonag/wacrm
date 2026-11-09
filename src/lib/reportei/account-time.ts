// An ad account lives in its own time zone, and Meta reads a date range in that zone. The
// policy of this integration: the dates we ask for (YYYY-MM-DD) go to Meta as they are, and
// Meta applies them in the account's zone; we never ask for days that have not started yet
// in that zone ("today" differs from São Paulo's around midnight), and the zone and the range
// really used are kept with the result. Pure.

/** The calendar date (YYYY-MM-DD) it is in a time zone right now, or null when the zone is unknown or invalid. */
export function accountToday(timezone: string | null | undefined, now: Date = new Date()): string | null {
  if (!timezone) return null;
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return null;
  }
}

export interface Span {
  since: string;
  until: string;
}

/**
 * The range as the account can answer it: never past the account's own today. `empty` when the
 * whole range is still in the future there; `clamped` says the end was moved. With an unknown
 * zone nothing is changed (and nothing is assumed). Pure.
 */
export function rangeForAccount(range: Span, today: string | null): { range: Span; clamped: boolean; empty: boolean } {
  if (!today || range.until <= today) return { range, clamped: false, empty: false };
  if (range.since > today) return { range, clamped: false, empty: true };
  return { range: { since: range.since, until: today }, clamped: true, empty: false };
}
