// Saved reports (Operacional → Reportei → Relatórios): the frozen numbers of a
// client's ad accounts for a period, optionally against the previous period.
// Pure helpers only; the data comes from Meta (meta-ads.ts) and is stored as-is.

import type { AccountInsights } from "@/lib/reportei/meta-ads";

export const METRICS = ["spend", "impressions", "reach", "clicks", "ctr", "cpc", "cpm"] as const;
export type MetricKey = (typeof METRICS)[number];

/** Metrics where a drop is the good direction. Spend has no good direction. */
const LOWER_IS_BETTER: ReadonlySet<MetricKey> = new Set(["cpc", "cpm"]);
const NEUTRAL: ReadonlySet<MetricKey> = new Set(["spend"]);

export type AccountError = "connection_unavailable" | "token_invalid" | "permission" | "request_failed";

export interface AccountSnapshot {
  id: string;
  name: string;
  currency: string | null;
  insights?: AccountInsights;
  /** The comparison period for the same account; absent when comparison is off or it failed. */
  previous?: AccountInsights;
  error?: AccountError;
  detail?: string;
}

export interface ReportSnapshot {
  period: { since: string; until: string };
  compare: { since: string; until: string } | null;
  accounts: AccountSnapshot[];
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 24 * 60 * 60 * 1000;
export const MAX_RANGE_DAYS = 366;

const toDate = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
const toYmd = (d: Date) => d.toISOString().slice(0, 10);

export function isYmd(v: unknown): v is string {
  if (typeof v !== "string" || !YMD.test(v)) return false;
  const d = toDate(v);
  return !Number.isNaN(d.getTime()) && toYmd(d) === v;
}

/** Days in the range, both ends included. */
export function rangeDays(since: string, until: string): number {
  return Math.round((toDate(until).getTime() - toDate(since).getTime()) / DAY) + 1;
}

/** since <= until, within MAX_RANGE_DAYS, and not later than `today` (YYYY-MM-DD). */
export function isValidRange(since: unknown, until: unknown, today: string): since is string {
  if (!isYmd(since) || !isYmd(until)) return false;
  if (since > until || until > today) return false;
  return rangeDays(since, until) <= MAX_RANGE_DAYS;
}

/** The range of the same length that ends the day before `since`. */
export function previousRange(since: string, until: string): { since: string; until: string } {
  const days = rangeDays(since, until);
  const end = new Date(toDate(since).getTime() - DAY);
  const start = new Date(end.getTime() - (days - 1) * DAY);
  return { since: toYmd(start), until: toYmd(end) };
}

/** Percent change from `previous` to `current`; null when there is no base to compare to. */
export function variation(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export type Tone = "good" | "bad" | "neutral";

/** How to color a change: costs going down are good, spend is never judged, a flat change is neutral. */
export function toneFor(metric: MetricKey, change: number | null): Tone {
  if (change === null || Math.abs(change) < 0.05 || NEUTRAL.has(metric)) return "neutral";
  const up = change > 0;
  return LOWER_IS_BETTER.has(metric) ? (up ? "bad" : "good") : up ? "good" : "bad";
}
