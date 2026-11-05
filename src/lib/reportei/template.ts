// Report templates: which metrics and charts a report shows. The choices are
// copied into the report's snapshot when it is generated, so a later edit of the
// template never changes a report that already exists.

import { DAILY_METRICS, METRICS, type DailyMetric, type MetricKey } from "@/lib/reportei/report";

export interface ReportOptions {
  metrics: MetricKey[];
  /** Day-by-day chart. Off means the chart is not drawn and Meta is not asked for the daily series. */
  chart: boolean;
  chartMetrics: DailyMetric[];
  /** Short text shown at the top of the report. */
  intro: string;
}

export const DEFAULT_OPTIONS: ReportOptions = {
  metrics: [...METRICS],
  chart: true,
  chartMetrics: [...DAILY_METRICS],
  intro: "",
};

export const INTRO_MAX = 1000;
export const NAME_MAX = 80;

/** The template as the screens and the API see it. */
export interface Template extends ReportOptions {
  id: string;
  name: string;
  compare: boolean;
}

const keep = <T extends string>(all: readonly T[], value: unknown): T[] | null => {
  if (!Array.isArray(value)) return null;
  const set = new Set(value);
  // Keep the canonical order, drop anything unknown.
  return all.filter((k) => set.has(k));
};

/** Valid options from untrusted input (a template form), or null when unusable. */
export function parseOptions(input: unknown): ReportOptions | null {
  if (typeof input !== "object" || input === null) return null;
  const o = input as Record<string, unknown>;
  const metrics = keep(METRICS, o.metrics);
  if (!metrics || metrics.length === 0) return null;
  const chart = o.chart === true;
  const chartMetrics = keep(DAILY_METRICS, o.chartMetrics);
  if (chart && (!chartMetrics || chartMetrics.length === 0)) return null;
  const intro = typeof o.intro === "string" ? o.intro.trim() : "";
  if (intro.length > INTRO_MAX) return null;
  return { metrics, chart, chartMetrics: chart ? (chartMetrics ?? []) : [], intro };
}

/** Name from untrusted input, or null when empty or too long. */
export function parseName(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const name = input.trim();
  return name.length >= 1 && name.length <= NAME_MAX ? name : null;
}

/** What to show for a saved report: its own copy of the choices, or everything for reports saved before templates. */
export function effectiveOptions(options: Partial<ReportOptions> | undefined): ReportOptions {
  if (!options) return DEFAULT_OPTIONS;
  const metrics = keep(METRICS, options.metrics);
  const chartMetrics = keep(DAILY_METRICS, options.chartMetrics);
  return {
    metrics: metrics && metrics.length > 0 ? metrics : DEFAULT_OPTIONS.metrics,
    chart: options.chart !== false,
    chartMetrics: chartMetrics && chartMetrics.length > 0 ? chartMetrics : DEFAULT_OPTIONS.chartMetrics,
    intro: typeof options.intro === "string" ? options.intro : "",
  };
}

interface TemplateRow {
  id: string;
  name: string;
  metrics: string[];
  chart: boolean;
  chart_metrics: string[];
  compare: boolean;
  intro: string | null;
}

export function templateFromRow(row: TemplateRow): Template {
  const options = effectiveOptions({ metrics: row.metrics as MetricKey[], chart: row.chart, chartMetrics: row.chart_metrics as DailyMetric[], intro: row.intro ?? "" });
  return { id: row.id, name: row.name, compare: row.compare, ...options };
}

export function optionsOf(t: ReportOptions): ReportOptions {
  return { metrics: t.metrics, chart: t.chart, chartMetrics: t.chartMetrics, intro: t.intro };
}
