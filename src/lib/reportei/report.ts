// Saved reports (Operacional → Reportei → Relatórios): the frozen numbers of a
// client's ad accounts for a period, optionally against the previous period.
// Pure helpers only; the data comes from Meta (meta-ads.ts) and is stored as-is.

import type { AccountInsights } from "@/lib/reportei/meta-ads";
import type { ReportOptions } from "@/lib/reportei/template";
import type { ReportDoc } from "@/lib/reportei/doc";
import type { TimelineEvent } from "@/lib/reportei/timeline";
import type { CampaignPeriodRow } from "@/lib/reportei/campaign-table";
import type { AdPeriodRow } from "./ad-table";

export const METRICS = ["spend", "impressions", "reach", "clicks", "ctr", "cpc", "cpm", "leads", "conversations", "costPerLead"] as const;
export type MetricKey = (typeof METRICS)[number];

/** Metrics where a drop is the good direction. Spend has no good direction. */
const LOWER_IS_BETTER: ReadonlySet<MetricKey> = new Set(["cpc", "cpm", "costPerLead"]);
const NEUTRAL: ReadonlySet<MetricKey> = new Set(["spend"]);

/** One day of an ad account, as saved in a report for the charts. */
export interface DailyPoint {
  date: string;
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
}
export const DAILY_METRICS = ["spend", "clicks", "impressions", "reach"] as const;
export type DailyMetric = (typeof DAILY_METRICS)[number];

export type AccountError = "connection_unavailable" | "token_invalid" | "permission" | "request_failed";

export interface AccountSnapshot {
  clientId?: string;
  id: string;
  name: string;
  currency: string | null;
  /** The account's own time zone (from Meta). Dates are read in it; null = unknown. */
  timezone?: string | null;
  /** The range actually read, in that zone (the requested one, or cut at the account's today). */
  range?: { since: string; until: string };
  /** The comparison range actually read. */
  compareRange?: { since: string; until: string };
  /** How many campaigns the numbers are limited to; absent means the whole account. */
  campaigns?: number;
  campaignTable?: { rows: CampaignPeriodRow[]; readAt: string };
  campaignTableError?: string;
  adTable?: { rows: AdPeriodRow[]; readAt: string; metadataUnavailable: boolean };
  adTableError?: string;
  insights?: AccountInsights;
  /** The comparison period for the same account; absent when comparison is off or it failed. */
  previous?: AccountInsights;
  /** Per-day series for the period and, when comparing, the previous one. Absent in reports saved before charts existed. */
  daily?: DailyPoint[];
  dailyPrevious?: DailyPoint[];
  error?: AccountError;
  detail?: string;
}

export interface ReportSnapshot {
  period: { since: string; until: string };
  compare: { since: string; until: string } | null;
  accounts: AccountSnapshot[];
  /** What the template chose to show. Absent in reports saved before templates: show everything. */
  options?: ReportOptions;
  /** Milestones of the client's marketing timeline that fall inside the period, when it was generated. */
  timeline?: TimelineEvent[];
  /** The report as a document of blocks and indicators (reports made in the editor). */
  doc?: ReportDoc;
}

/** Result metrics only make sense for accounts that run lead or messaging campaigns. */
const RESULT_METRICS: ReadonlySet<MetricKey> = new Set(["leads", "conversations", "costPerLead"]);

/**
 * The metrics a report shows for one account, in the template's order. A metric the
 * report does not have (saved before it existed) is skipped, and so are result
 * metrics that are zero in both periods (no leads or conversations to talk about).
 */
export function visibleMetrics(wanted: readonly MetricKey[], insights: AccountInsights, previous?: AccountInsights): MetricKey[] {
  return wanted.filter((key) => {
    const current = insights[key];
    if (typeof current !== "number") return false;
    if (!RESULT_METRICS.has(key)) return true;
    const before = previous?.[key];
    return current > 0 || (typeof before === "number" && before > 0);
  });
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
export function variation(current: number | undefined, previous: number | undefined): number | null {
  if (current === undefined || previous === undefined || !Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

export type Tone = "good" | "bad" | "neutral";

/** How to color a change: costs going down are good, spend is never judged, a flat change is neutral. */
export function toneFor(metric: MetricKey, change: number | null): Tone {
  if (change === null || Math.abs(change) < 0.05 || NEUTRAL.has(metric)) return "neutral";
  const up = change > 0;
  return LOWER_IS_BETTER.has(metric) ? (up ? "bad" : "good") : up ? "good" : "bad";
}

/** One point per day from `since` to `until`, in order; days Meta did not report are zeros. Extra or duplicate days are ignored. */
export function fillDays(points: readonly DailyPoint[], since: string, until: string): DailyPoint[] {
  const byDate = new Map(points.map((p) => [p.date, p]));
  const out: DailyPoint[] = [];
  const total = rangeDays(since, until);
  for (let i = 0; i < total; i++) {
    const date = toYmd(new Date(toDate(since).getTime() + i * DAY));
    out.push(byDate.get(date) ?? { date, spend: 0, impressions: 0, reach: 0, clicks: 0 });
  }
  return out;
}
