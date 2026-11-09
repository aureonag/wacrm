// Dashboards of a client, in Reportei's v4 format: the same document as a report
// (a block per network with its indicators) without the cover, plus a period that
// applies to the whole dashboard. Changing the period asks the data source again for
// every indicator of the dashboard; today that is the demo source, later one per network.

import { makeId, type ReportDoc } from "./doc";
import { demoSource } from "./doc-catalog";
import { DASHBOARD_LAYOUT, buildDocFromTemplate } from "./doc-templates";
import { refreshPreserving } from "./meta-doc";
import { previousRange } from "./report";
import { resolvePeriod } from "./periods";
import { isWizardPeriod, resolveWizardPeriod, type DateRange, type WizardPeriod } from "./wizard";

/** The periods of the selector, in Reportei's order. */
export const DASHBOARD_PRESETS = ["today", "yesterday", "last_7d", "last_15d", "last_30d", "this_week", "last_week", "this_month", "last_month", "last_quarter"] as const;
export type DashboardPreset = (typeof DASHBOARD_PRESETS)[number];

export const PRESET_LABEL: Record<DashboardPreset, string> = {
  today: "Hoje",
  yesterday: "Ontem",
  last_7d: "Últimos 7 dias",
  last_15d: "Últimos 15 dias",
  last_30d: "Últimos 30 dias",
  this_week: "Semana até o momento",
  last_week: "Última semana",
  this_month: "Mês até o momento",
  last_month: "Último mês",
  last_quarter: "Último trimestre",
};

export interface DashboardPeriod {
  preset: DashboardPreset | "custom";
  since: string;
  until: string;
}

/** Every dashboard opens month-to-date, independently of an earlier manual selection. */
export function dashboardOpeningPeriod(now = new Date()): DashboardPeriod {
  return { preset: "this_month", ...resolvePeriod("this_month", now) };
}

const DAY = 24 * 60 * 60 * 1000;
const toYmd = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (ymd: string, n: number) => toYmd(new Date(new Date(`${ymd}T00:00:00Z`).getTime() + n * DAY));

export function resolveDashboardPreset(preset: DashboardPreset, today: string): DateRange {
  if (preset === "yesterday") {
    const y = addDays(today, -1);
    return { since: y, until: y };
  }
  if (preset === "this_week") {
    const monday = addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
    return { since: monday, until: today };
  }
  const wizard: WizardPeriod = preset;
  return resolveWizardPeriod(wizard, today);
}

export function parsePeriod(v: unknown): DashboardPeriod | null {
  if (!v || typeof v !== "object") return null;
  const p = v as Record<string, unknown>;
  const ymd = /^\d{4}-\d{2}-\d{2}$/;
  if (typeof p.since !== "string" || typeof p.until !== "string" || !ymd.test(p.since) || !ymd.test(p.until) || p.since > p.until) return null;
  const preset = p.preset === "custom" || (typeof p.preset === "string" && (DASHBOARD_PRESETS as readonly string[]).includes(p.preset)) ? (p.preset as DashboardPeriod["preset"]) : "custom";
  return { preset, since: p.since, until: p.until };
}

/** The range the comparison covers: the same number of days right before the period. */
export const comparisonOf = (range: DateRange): DateRange => previousRange(range.since, range.until);

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "31 out – 6 nov 2026", or "1 – 7 nov 2026" inside one month; the year only once when it is the same. */
export function formatRangeShort(since: string, until: string): string {
  const [y1, m1, d1] = since.split("-").map(Number);
  const [y2, m2, d2] = until.split("-").map(Number);
  if (since === until) return `${d1} ${MONTHS[m1 - 1]} ${y1}`;
  if (y1 === y2 && m1 === m2) return `${d1} – ${d2} ${MONTHS[m2 - 1]} ${y2}`;
  if (y1 === y2) return `${d1} ${MONTHS[m1 - 1]} – ${d2} ${MONTHS[m2 - 1]} ${y2}`;
  return `${d1} ${MONTHS[m1 - 1]} ${y1} – ${d2} ${MONTHS[m2 - 1]} ${y2}`;
}

/** How many days a range covers, both ends included. */
export function rangeLength(since: string, until: string): number {
  return Math.round((new Date(`${until}T00:00:00Z`).getTime() - new Date(`${since}T00:00:00Z`).getTime()) / DAY) + 1;
}

export interface DashboardAccount {
  network: string;
  account: string;
}

/** A new dashboard: the Padrão layout filled for the client's integrations, with no cover. */
export function buildDashboardDoc(accounts: DashboardAccount[], range: DateRange, seed: string): ReportDoc {
  const doc = buildDocFromTemplate({ layout: DASHBOARD_LAYOUT, integrations: accounts, range, seed, source: demoSource }, makeId);
  return { ...doc, cover: { ...doc.cover, hidden: true } };
}

/**
 * The same dashboard with the made-up numbers of another period (only for marked models). Blocks,
 * their order, titles, texts, analyses and every indicator a person kept, moved, resized, removed or
 * added stay as they are; only the numbers inside the indicators change.
 */
export function refreshDashboardDoc(doc: ReportDoc, range: DateRange, seed: string): ReportDoc {
  return refreshPreserving(doc, (block, w) => {
    if (!w.key) return null;
    const fresh = demoSource.widget(block.kind === "custom" ? "custom" : (block.network ?? ""), w.key, { id: w.id, range, seed: `${seed}:${block.network ?? "custom"}` });
    return fresh ? { widget: fresh } : null;
  });
}

export const isPresetValue = (v: unknown): v is WizardPeriod => isWizardPeriod(v);
