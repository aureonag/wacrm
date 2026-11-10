import { safeAdThumbnail } from "./ad-table";
// The report as a document, like Reportei's editor: a cover plus blocks (one per
// network, and the custom one that sums several), each holding indicators
// (numbers, charts, tables, stories) the person can move, enlarge, highlight,
// duplicate, edit and remove. Pure: types, validation, the editing operations
// (all immutable) and the text/CSV of one indicator. The numbers inside are
// frozen when the report is made, like the rest of a saved report.

import { variation } from "@/lib/reportei/report";

export type WidgetKind = "metric" | "bar" | "line" | "groupedBar" | "pie" | "table" | "posts" | "stories";
export const WIDGET_KINDS: readonly WidgetKind[] = ["metric", "bar", "line", "groupedBar", "pie", "table", "posts", "stories"];

export type MetricFormat = "int" | "percent" | "money";

interface WidgetBase {
  id: string;
  /** The catalog entry it was made from (so a report can be saved as a template); absent in older documents. */
  key?: string;
  kind: WidgetKind;
  title: string;
  /** The text behind the "?" next to the title. */
  description: string;
  /** "wide" doubles the width (a number takes half the row, a chart the whole row). */
  size: "normal" | "wide";
  highlight: boolean;
  /** A period of its own ("02/10/2026 a 31/10/2026") when it is not the report's. */
  period: { since: string; until: string } | null;
  /** Why there is no number: the indicator stays in the document, empty, with this reason (never a made-up zero). */
  unavailable?: string;
}

export interface MetricWidget extends WidgetBase {
  currency?: string;
  kind: "metric";
  value: number;
  previous: number | null;
  decimals: number;
  format: MetricFormat;
  /** Show "N no período anterior" and the change. */
  comparison: boolean;
  /** Show the change as an absolute difference instead of a percentage. */
  absolute: boolean;
  /** Whether going up is the good direction (false for costs). */
  upIsGood: boolean;
  /** Networks that make up the number (icons under the title in the custom block). */
  networks: string[];
}

export interface Point {
  label: string;
  value: number;
}

export interface SeriesWidget extends WidgetBase {
  kind: "bar" | "line";
  seriesName: string;
  points: Point[];
}

export interface GroupedBarWidget extends WidgetBase {
  kind: "groupedBar";
  categories: string[];
  series: { name: string; color: string; values: number[] }[];
}

export interface PieWidget extends WidgetBase {
  kind: "pie";
  slices: { label: string; value: number; color: string }[];
}

export interface Column {
  key: string;
  label: string;
  align: "left" | "right";
}

export interface TableWidget extends WidgetBase {
  kind: "table";
  currency?: string;
  campaignReadAt?: string;
  adReadAt?: string;
  adMetadataUnavailable?: boolean;
  adThumbnails?: Record<string, string>;
  adPreviews?: Record<string, string>;
  columns: Column[];
  rows: Record<string, string | number>[];
  sortKey: string | null;
}

export interface PostsWidget extends WidgetBase {
  kind: "posts";
  /** Columns after the post itself. */
  columns: Column[];
  rows: { hue: number; text: string; values: Record<string, string | number> }[];
  sortKey: string | null;
}

export interface StoriesWidget extends WidgetBase {
  kind: "stories";
  items: { hue: number; date: string; stats: { label: string; value: string | number }[] }[];
}

export type Widget = MetricWidget | SeriesWidget | GroupedBarWidget | PieWidget | TableWidget | PostsWidget | StoriesWidget;

export interface Block {
  id: string;
  kind: "custom" | "network";
  /** Catalog key of the network (e.g. "instagram_business"); absent on the custom block. */
  network?: string;
  title: string;
  /** The account under the title (e.g. "amex.log"). A label: the real account is `accountId`. */
  subtitle: string;
  /** The linked ad account this block shows (act_…), for refreshing its numbers. Never matched by name. */
  accountId?: string;
  /** Free text under the block, written by a person. */
  analysis: string;
  hidden: boolean;
  widgets: Widget[];
}

export interface ReportDoc {
  version: 1;
  /** The numbers are made up, only to see the interface (reports of the model client). */
  demo: boolean;
  cover: { hidden: boolean; subtitle: string; analysis: string };
  blocks: Block[];
}

export const LIMITS = { blocks: 20, widgetsPerBlock: 200, text: 5000, title: 200, rows: 500, points: 400, json: 600_000 } as const;

// ---- ids ---------------------------------------------------------------------------

export type IdMaker = (prefix: string) => string;
export const makeId: IdMaker = (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;

// ---- finding -----------------------------------------------------------------------

export function findWidget(doc: ReportDoc, widgetId: string): { block: Block; index: number } | null {
  for (const block of doc.blocks) {
    const index = block.widgets.findIndex((w) => w.id === widgetId);
    if (index >= 0) return { block, index };
  }
  return null;
}

const mapBlocks = (doc: ReportDoc, fn: (b: Block) => Block): ReportDoc => ({ ...doc, blocks: doc.blocks.map(fn) });

// ---- editing operations (immutable) --------------------------------------------------

/** Changes some fields of one indicator. */
export function updateWidget(doc: ReportDoc, widgetId: string, patch: Partial<Widget>): ReportDoc {
  return mapBlocks(doc, (b) => ({ ...b, widgets: b.widgets.map((w) => (w.id === widgetId ? ({ ...w, ...patch, id: w.id, kind: w.kind } as Widget) : w)) }));
}

export const toggleHighlight = (doc: ReportDoc, widgetId: string): ReportDoc => {
  const found = findWidget(doc, widgetId);
  return found ? updateWidget(doc, widgetId, { highlight: !found.block.widgets[found.index].highlight }) : doc;
};

/** The two sizes of an indicator: its normal width and double that. */
export const toggleSize = (doc: ReportDoc, widgetId: string): ReportDoc => {
  const found = findWidget(doc, widgetId);
  return found ? updateWidget(doc, widgetId, { size: found.block.widgets[found.index].size === "wide" ? "normal" : "wide" }) : doc;
};

export function deleteWidget(doc: ReportDoc, widgetId: string): ReportDoc {
  return mapBlocks(doc, (b) => ({ ...b, widgets: b.widgets.filter((w) => w.id !== widgetId) }));
}

/** A copy right after the original, with its own id. */
export function duplicateWidget(doc: ReportDoc, widgetId: string, newId: IdMaker = makeId): ReportDoc {
  const found = findWidget(doc, widgetId);
  if (!found || found.block.widgets.length >= LIMITS.widgetsPerBlock) return doc;
  const original = found.block.widgets[found.index];
  const copy = { ...structuredClone(original), id: newId("w"), highlight: false } as Widget;
  return mapBlocks(doc, (b) => (b.id === found.block.id ? { ...b, widgets: [...b.widgets.slice(0, found.index + 1), copy, ...b.widgets.slice(found.index + 1)] } : b));
}

/** Moves an indicator to a position of a block (the same one or another). Positions are those of the list WITHOUT the moved one. */
export function moveWidget(doc: ReportDoc, widgetId: string, toBlockId: string, toIndex: number): ReportDoc {
  const found = findWidget(doc, widgetId);
  const target = doc.blocks.find((b) => b.id === toBlockId);
  if (!found || !target) return doc;
  if (found.block.id !== target.id && target.widgets.length >= LIMITS.widgetsPerBlock) return doc;
  const moving = found.block.widgets[found.index];
  const without = deleteWidget(doc, widgetId);
  return mapBlocks(without, (b) => {
    if (b.id !== toBlockId) return b;
    const at = Math.max(0, Math.min(toIndex, b.widgets.length));
    return { ...b, widgets: [...b.widgets.slice(0, at), moving, ...b.widgets.slice(at)] };
  });
}

/** Two indicators trade places, each keeping its own size and settings (works across blocks too). */
export function swapWidgets(doc: ReportDoc, aId: string, bId: string): ReportDoc {
  if (aId === bId) return doc;
  const a = findWidget(doc, aId);
  const b = findWidget(doc, bId);
  if (!a || !b) return doc;
  const wa = a.block.widgets[a.index];
  const wb = b.block.widgets[b.index];
  return mapBlocks(doc, (blk) => ({ ...blk, widgets: blk.widgets.map((w) => (w.id === aId ? wb : w.id === bId ? wa : w)) }));
}

/** Appends indicators to the end of a block (what "Adicionar métricas" does), up to the limit. */
export function addWidgets(doc: ReportDoc, blockId: string, widgets: Widget[]): ReportDoc {
  return mapBlocks(doc, (b) => (b.id === blockId ? { ...b, widgets: [...b.widgets, ...widgets].slice(0, LIMITS.widgetsPerBlock) } : b));
}

export function updateBlock(doc: ReportDoc, blockId: string, patch: Partial<Pick<Block, "title" | "subtitle" | "analysis" | "hidden">>): ReportDoc {
  return mapBlocks(doc, (b) => (b.id === blockId ? { ...b, ...patch } : b));
}

export const deleteBlock = (doc: ReportDoc, blockId: string): ReportDoc => ({ ...doc, blocks: doc.blocks.filter((b) => b.id !== blockId) });

/** Puts a block at a position of the block list. */
export function moveBlock(doc: ReportDoc, blockId: string, toIndex: number): ReportDoc {
  const from = doc.blocks.findIndex((b) => b.id === blockId);
  if (from < 0) return doc;
  const blocks = [...doc.blocks];
  const [moving] = blocks.splice(from, 1);
  blocks.splice(Math.max(0, Math.min(toIndex, blocks.length)), 0, moving);
  return { ...doc, blocks };
}

export function addBlock(doc: ReportDoc, block: Block, atIndex = doc.blocks.length): ReportDoc {
  if (doc.blocks.length >= LIMITS.blocks) return doc;
  const blocks = [...doc.blocks];
  blocks.splice(Math.max(0, Math.min(atIndex, blocks.length)), 0, block);
  return { ...doc, blocks };
}

export const updateCover = (doc: ReportDoc, patch: Partial<ReportDoc["cover"]>): ReportDoc => ({ ...doc, cover: { ...doc.cover, ...patch } });

// ---- showing a number ------------------------------------------------------------------

const fmt = (n: number, decimals: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

export function formatValue(value: number, format: MetricFormat, decimals: number, currency = "BRL"): string {
  switch (format) {
    case "percent":
      return `${fmt(value, decimals)}%`;
    case "money":
      return value.toLocaleString("pt-BR", { style: "currency", currency, minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    default:
      return fmt(value, decimals);
  }
}

export interface ChangeView {
  /** "+1,09%" / "−23,32%" / "+57" */
  text: string;
  tone: "good" | "bad" | "neutral";
  up: boolean;
}

/** The change of a number against the previous period, or null when there is nothing to compare. */
export function changeOf(w: MetricWidget): ChangeView | null {
  if (!w.comparison || w.previous === null) return null;
  const sign = (n: number) => (n >= 0 ? "+" : "−");
  if (w.absolute) {
    const diff = w.value - w.previous;
    return { text: `${sign(diff)}${fmt(Math.abs(diff), w.decimals)}`, tone: w.key === "spend" || w.key === "total_spend" || diff === 0 ? "neutral" : diff > 0 === w.upIsGood ? "good" : "bad", up: diff >= 0 };
  }
  const pct = variation(w.value, w.previous);
  if (pct === null) return null;
  return { text: `${sign(pct)}${fmt(Math.abs(pct), 2)}%`, tone: w.key === "spend" || w.key === "total_spend" || Math.abs(pct) < 0.005 ? "neutral" : pct > 0 === w.upIsGood ? "good" : "bad", up: pct >= 0 };
}

// ---- export of one indicator -----------------------------------------------------------

const cell = (v: string | number | null | undefined): string => {
  if (v === null || v === undefined) return "";
  let t = typeof v === "number" ? String(v).replace(".", ",") : v;
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[";\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
const line = (cells: (string | number | null)[]) => cells.map(cell).join(";");

/** CSV (Excel pt-BR: `;`, comma decimals, BOM) of one indicator. */
export function widgetToCsv(w: Widget): string {
  if (w.unavailable) return "\uFEFF" + line(["Indicador", "Estado"]) + "\n" + line([w.title, w.unavailable]);
  const rows: string[] = [];
  switch (w.kind) {
    case "metric":
      rows.push(line(["Indicador", "Valor", "Período anterior", "Variação"]));
      rows.push(line([w.title, w.value, w.previous, changeOf(w)?.text ?? ""]));
      break;
    case "bar":
    case "line":
      rows.push(line(["Data", w.seriesName]));
      for (const p of w.points) rows.push(line([p.label, p.value]));
      break;
    case "groupedBar":
      rows.push(line(["Categoria", ...w.series.map((s) => s.name)]));
      w.categories.forEach((c, i) => rows.push(line([c, ...w.series.map((s) => s.values[i] ?? null)])));
      break;
    case "pie":
      rows.push(line(["Item", "Valor"]));
      for (const s of w.slices) rows.push(line([s.label, s.value]));
      break;
    case "table":
      rows.push(line(w.columns.map((c) => c.label)));
      for (const r of w.rows) rows.push(line(w.columns.map((c) => r[c.key] ?? null)));
      break;
    case "posts":
      rows.push(line(["Postagem", ...w.columns.map((c) => c.label)]));
      for (const r of w.rows) rows.push(line([r.text, ...w.columns.map((c) => r.values[c.key] ?? null)]));
      break;
    case "stories": {
      const labels = w.items[0]?.stats.map((s) => s.label) ?? [];
      rows.push(line(["Data", ...labels]));
      for (const it of w.items) rows.push(line([it.date, ...it.stats.map((s) => s.value)]));
      break;
    }
  }
  return "﻿" + rows.join("\r\n") + "\r\n";
}

/** Sorted copy of table rows by a column, high to low for numbers (the ▼ header of Reportei). */
export function sortRows<T extends Record<string, string | number>>(rows: readonly T[], key: string | null): T[] {
  if (!key) return [...rows];
  return [...rows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (typeof av === "number" && typeof bv === "number") return bv - av;
    return String(av ?? "").localeCompare(String(bv ?? ""), "pt-BR");
  });
}

// ---- validation of what comes from the browser -------------------------------------------

const isStr = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const YMD = /^\d{4}-\d{2}-\d{2}$/;

function validPeriod(v: unknown): boolean {
  return v === null || (isObj(v) && typeof v.since === "string" && typeof v.until === "string" && YMD.test(v.since) && YMD.test(v.until) && v.since <= v.until);
}

function validColumns(v: unknown): boolean {
  return Array.isArray(v) && v.length <= 30 && v.every((c) => isObj(c) && isStr(c.key, 60) && isStr(c.label, 80) && (c.align === "left" || c.align === "right"));
}

function validCells(v: unknown): boolean {
  return isObj(v) && Object.values(v).every((x) => typeof x === "string" ? x.length <= 400 : isNum(x));
}

/** Whether a value is a well-formed indicator (shape, kinds, bounded sizes). */
export function isWidget(v: unknown): v is Widget {
  if (!isObj(v) || !isStr(v.id, 80) || !v.id || !WIDGET_KINDS.includes(v.kind as WidgetKind)) return false;
  if (!isStr(v.title, LIMITS.title) || !isStr(v.description, LIMITS.text)) return false;
  if (v.key !== undefined && !isStr(v.key, 60)) return false;
  if (v.unavailable !== undefined && !isStr(v.unavailable, 300)) return false;
  if ((v.size !== "normal" && v.size !== "wide") || typeof v.highlight !== "boolean" || !validPeriod(v.period)) return false;
  switch (v.kind) {
    case "metric":
      return (v.currency === undefined || (typeof v.currency === "string" && /^[A-Z]{3}$/.test(v.currency))) && isNum(v.value) && (v.previous === null || isNum(v.previous)) && isNum(v.decimals) && v.decimals >= 0 && v.decimals <= 6 && ["int", "percent", "money"].includes(v.format as string) &&
        typeof v.comparison === "boolean" && typeof v.absolute === "boolean" && typeof v.upIsGood === "boolean" && Array.isArray(v.networks) && v.networks.length <= 12 && v.networks.every((n) => isStr(n, 40));
    case "bar":
    case "line":
      return isStr(v.seriesName, 80) && Array.isArray(v.points) && v.points.length <= LIMITS.points && v.points.every((p) => isObj(p) && isStr(p.label, 60) && isNum(p.value));
    case "groupedBar":
      return Array.isArray(v.categories) && v.categories.length <= 60 && v.categories.every((c) => isStr(c, 60)) && Array.isArray(v.series) && v.series.length <= 8 &&
        v.series.every((s) => isObj(s) && isStr(s.name, 60) && isStr(s.color, 20) && Array.isArray(s.values) && s.values.length <= 60 && s.values.every(isNum));
    case "pie":
      return Array.isArray(v.slices) && v.slices.length <= 30 && v.slices.every((s) => isObj(s) && isStr(s.label, 60) && isNum(s.value) && isStr(s.color, 20));
    case "table":
      return (v.adPreviews === undefined || (isObj(v.adPreviews) && Object.keys(v.adPreviews).length <= LIMITS.rows && Object.entries(v.adPreviews).every(([id, url]) => /^\d{1,30}$/.test(id) && safeAdThumbnail(url) !== null))) && (v.adReadAt === undefined || (isStr(v.adReadAt, 40) && Number.isFinite(Date.parse(v.adReadAt as string)))) && (v.adMetadataUnavailable === undefined || typeof v.adMetadataUnavailable === "boolean") && (v.adThumbnails === undefined || (isObj(v.adThumbnails) && Object.keys(v.adThumbnails).length <= LIMITS.rows && Object.entries(v.adThumbnails).every(([id, url]) => /^\d{1,30}$/.test(id) && safeAdThumbnail(url) !== null))) && (v.currency === undefined || (typeof v.currency === "string" && /^[A-Z]{3}$/.test(v.currency))) && (v.campaignReadAt === undefined || (isStr(v.campaignReadAt, 40) && Number.isFinite(Date.parse(v.campaignReadAt as string)))) && validColumns(v.columns) && Array.isArray(v.rows) && v.rows.length <= LIMITS.rows && v.rows.every(validCells) && (v.sortKey === null || isStr(v.sortKey, 60));
    case "posts":
      return validColumns(v.columns) && Array.isArray(v.rows) && v.rows.length <= LIMITS.rows && (v.sortKey === null || isStr(v.sortKey, 60)) &&
        v.rows.every((r) => isObj(r) && isNum(r.hue) && isStr(r.text, 400) && validCells(r.values));
    case "stories":
      return Array.isArray(v.items) && v.items.length <= 100 &&
        v.items.every((it) => isObj(it) && isNum(it.hue) && isStr(it.date, 20) && Array.isArray(it.stats) && it.stats.length <= 30 &&
          it.stats.every((s) => isObj(s) && isStr(s.label, 60) && (isNum(s.value) || isStr(s.value, 60))));
  }
  return false;
}

function isBlock(v: unknown): v is Block {
  return isObj(v) && isStr(v.id, 80) && !!v.id && (v.kind === "custom" || v.kind === "network") && (v.network === undefined || isStr(v.network, 60)) && (v.accountId === undefined || (isStr(v.accountId, 60) && /^act_\d+$/.test(v.accountId as string))) &&
    isStr(v.title, LIMITS.title) && isStr(v.subtitle, LIMITS.title) && isStr(v.analysis, LIMITS.text) && typeof v.hidden === "boolean" &&
    Array.isArray(v.widgets) && v.widgets.length <= LIMITS.widgetsPerBlock && v.widgets.every(isWidget);
}

/** A well-formed document from untrusted input (a save from the editor), or null. Ids must be unique. */
export function parseDoc(input: unknown): ReportDoc | null {
  if (!isObj(input) || input.version !== 1 || typeof input.demo !== "boolean") return null;
  const cover = input.cover;
  if (!isObj(cover) || typeof cover.hidden !== "boolean" || !isStr(cover.subtitle, LIMITS.title) || !isStr(cover.analysis, LIMITS.text)) return null;
  if (!Array.isArray(input.blocks) || input.blocks.length > LIMITS.blocks || !input.blocks.every(isBlock)) return null;
  const ids = new Set<string>();
  for (const b of input.blocks as Block[]) {
    for (const id of [b.id, ...b.widgets.map((w) => w.id)]) {
      if (ids.has(id)) return null;
      ids.add(id);
    }
  }
  if (JSON.stringify(input).length > LIMITS.json) return null;
  return input as unknown as ReportDoc;
}
