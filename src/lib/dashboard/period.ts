// Pure date-range math for the dashboard's period filters. No Supabase,
// no React — just Date in, {start, end} out, so both the top filter and
// the "closed deals by month" card's filter can share it.

export type PeriodKind = "today" | "yesterday" | "week" | "month" | "custom";

export interface DateRange {
  start: Date;
  end: Date;
}

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function endOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(23, 59, 59, 999);
  return out;
}

/** Monday-first offset: Monday=0 … Sunday=6. */
function mondayOffset(d: Date): number {
  return (d.getDay() + 6) % 7;
}

export function getPeriodRange(kind: PeriodKind, custom?: DateRange): DateRange {
  const now = new Date();

  switch (kind) {
    case "today":
      return { start: startOfDay(now), end: endOfDay(now) };
    case "yesterday": {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      return { start: startOfDay(y), end: endOfDay(y) };
    }
    case "week": {
      const monday = new Date(now);
      monday.setDate(monday.getDate() - mondayOffset(now));
      const sunday = new Date(monday);
      sunday.setDate(sunday.getDate() + 6);
      return { start: startOfDay(monday), end: endOfDay(sunday) };
    }
    case "month": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { start: startOfDay(start), end: endOfDay(end) };
    }
    case "custom":
      if (!custom) throw new Error("getPeriodRange('custom') requires a custom range");
      return { start: startOfDay(custom.start), end: endOfDay(custom.end) };
  }
}

export function isWithinRange(iso: string, range: DateRange): boolean {
  const t = new Date(iso).getTime();
  return t >= range.start.getTime() && t <= range.end.getTime();
}

// --- "Contratos fechados por mês" reporting ranges ------------------------

export type ReportingKind = "q1" | "q2" | "q3" | "q4" | "h1" | "h2" | "year" | "custom";

const QUARTER_MONTHS: Record<"q1" | "q2" | "q3" | "q4", [number, number]> = {
  q1: [0, 2],
  q2: [3, 5],
  q3: [6, 8],
  q4: [9, 11],
};
const SEMESTER_MONTHS: Record<"h1" | "h2", [number, number]> = {
  h1: [0, 5],
  h2: [6, 11],
};

export const MAX_CUSTOM_REPORTING_MONTHS = 12;

export function getReportingRange(
  kind: ReportingKind,
  year: number,
  custom?: DateRange,
): DateRange {
  if (kind === "year") {
    return {
      start: startOfDay(new Date(year, 0, 1)),
      end: endOfDay(new Date(year, 11, 31)),
    };
  }
  if (kind === "custom") {
    if (!custom) throw new Error("getReportingRange('custom') requires a custom range");
    return { start: startOfDay(custom.start), end: endOfDay(custom.end) };
  }
  const months = kind in QUARTER_MONTHS ? QUARTER_MONTHS[kind as keyof typeof QUARTER_MONTHS] : SEMESTER_MONTHS[kind as keyof typeof SEMESTER_MONTHS];
  const [fromMonth, toMonth] = months;
  return {
    start: startOfDay(new Date(year, fromMonth, 1)),
    end: endOfDay(new Date(year, toMonth + 1, 0)),
  };
}

/** Number of whole calendar months a custom range spans, inclusive. Used to
 *  enforce the 12-month cap on the "Período" option of the closed-deals card. */
export function monthSpan(range: DateRange): number {
  return (
    (range.end.getFullYear() - range.start.getFullYear()) * 12 +
    (range.end.getMonth() - range.start.getMonth()) +
    1
  );
}

/** One bucket per calendar month covered by `range`, in order. */
export function monthBucketsInRange(range: DateRange): Date[] {
  const out: Date[] = [];
  const cursor = new Date(range.start.getFullYear(), range.start.getMonth(), 1);
  const last = new Date(range.end.getFullYear(), range.end.getMonth(), 1);
  while (cursor.getTime() <= last.getTime()) {
    out.push(new Date(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return out;
}

export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
