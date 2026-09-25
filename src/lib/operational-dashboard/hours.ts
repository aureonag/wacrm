// Hours-worked series for the Operacional dashboard chart: one bar per
// day of the chosen week or month, built from timesheet entries.
// Days are local calendar days; an entry that crosses midnight is split
// between the days it touches, and a running timer counts up to `now`.

export type HoursMode = "week" | "month";

export interface HoursEntry {
  started_at: string;
  ended_at?: string | null;
}

export interface HoursBar {
  /** Local date, YYYY-MM-DD. */
  date: string;
  minutes: number;
}

export interface HoursSeries {
  bars: HoursBar[];
  totalMinutes: number;
  /** Inclusive local range covered by the bars. */
  start: string;
  end: string;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function toLocalIso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Monday of the week containing `d`. */
export function startOfWeek(d: Date): Date {
  const day = startOfDay(d);
  const offset = (day.getDay() + 6) % 7; // Monday = 0
  day.setDate(day.getDate() - offset);
  return day;
}

/** Moves the anchor one week or one month, keeping it a valid date. */
export function shiftAnchor(anchor: Date, mode: HoursMode, delta: number): Date {
  if (mode === "week") {
    const d = startOfDay(anchor);
    d.setDate(d.getDate() + 7 * delta);
    return d;
  }
  return new Date(anchor.getFullYear(), anchor.getMonth() + delta, 1);
}

export function buildHoursSeries(
  entries: HoursEntry[],
  mode: HoursMode,
  anchor: Date,
  now: Date = new Date(),
): HoursSeries {
  let first: Date;
  let count: number;
  if (mode === "week") {
    first = startOfWeek(anchor);
    count = 7;
  } else {
    first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    count = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate();
  }

  const bars: HoursBar[] = [];
  const index = new Map<string, HoursBar>();
  for (let i = 0; i < count; i++) {
    const d = new Date(first.getFullYear(), first.getMonth(), first.getDate() + i);
    const bar = { date: toLocalIso(d), minutes: 0 };
    bars.push(bar);
    index.set(bar.date, bar);
  }

  const rangeStart = first.getTime();
  const rangeEnd = new Date(first.getFullYear(), first.getMonth(), first.getDate() + count).getTime();

  for (const e of entries) {
    const from = new Date(e.started_at).getTime();
    const to = e.ended_at ? new Date(e.ended_at).getTime() : now.getTime();
    if (!(to > from) || to <= rangeStart || from >= rangeEnd) continue;
    let cursor = Math.max(from, rangeStart);
    const stop = Math.min(to, rangeEnd);
    while (cursor < stop) {
      const day = startOfDay(new Date(cursor));
      const nextDay = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
      const chunkEnd = Math.min(nextDay, stop);
      const bar = index.get(toLocalIso(day));
      if (bar) bar.minutes += (chunkEnd - cursor) / 60_000;
      cursor = chunkEnd;
    }
  }

  for (const b of bars) b.minutes = Math.round(b.minutes);
  return {
    bars,
    totalMinutes: bars.reduce((s, b) => s + b.minutes, 0),
    start: bars[0].date,
    end: bars[bars.length - 1].date,
  };
}
