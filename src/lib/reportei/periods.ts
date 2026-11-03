// Report periods for Operacional → Reportei. Dates are the ones a person in
// São Paulo sees, as YYYY-MM-DD (what Meta's Insights `time_range` takes).

export const PERIODS = ["last_7d", "last_30d", "this_month", "last_month"] as const;
export type Period = (typeof PERIODS)[number];

export function isPeriod(v: unknown): v is Period {
  return typeof v === "string" && (PERIODS as readonly string[]).includes(v);
}

const fmt = (d: Date) => d.toISOString().slice(0, 10);

/** Today's date in São Paulo as a UTC-midnight Date, so day arithmetic ignores the machine's timezone. */
function todaySaoPaulo(now: Date): Date {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
  return new Date(`${ymd}T00:00:00Z`);
}

const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 24 * 60 * 60 * 1000);

export function resolvePeriod(period: Period, now = new Date()): { since: string; until: string } {
  const today = todaySaoPaulo(now);
  switch (period) {
    case "last_7d":
      return { since: fmt(addDays(today, -6)), until: fmt(today) };
    case "last_30d":
      return { since: fmt(addDays(today, -29)), until: fmt(today) };
    case "this_month":
      return { since: fmt(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))), until: fmt(today) };
    case "last_month": {
      const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
      const last = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
      return { since: fmt(first), until: fmt(last) };
    }
  }
}
