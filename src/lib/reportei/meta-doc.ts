// A report or dashboard document filled with the REAL numbers of the Meta Ads accounts
// linked to a client (their snapshots), instead of the demo source. Pure.
//
// Rules: only Meta Ads is real today, so a network of the template that is not Meta Ads gets
// no block (it is listed in `skipped`, never filled with made-up numbers). A Meta Ads
// indicator the integration does not collect yet, or that the account has no data for
// (no purchase event, no leads to divide by…), stays in the document marked `unavailable` with
// the reason, never as a zero. Overlapping events are never added (see meta-ads pickAction).

import type { Block, IdMaker, MetricWidget, ReportDoc, Widget } from "./doc";
import { catalogEntry, defaultKeys, NETWORK_LABEL, type Range } from "./doc-catalog";
import type { TemplateLayout } from "./doc-templates";
import { attributionLabel } from "./event-config";
import { cplOf } from "./meta-ads";
import type { AccountSnapshot, DailyPoint } from "./report";

const dmy = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;

export const NOT_COLLECTED = "Este indicador ainda não é coletado da Meta.";
const NO_PURCHASE = "A conta não registrou eventos de compra no período.";
const NO_LEADS = "Sem leads no período para dividir o investimento.";
const NO_DAILY = "Os dados diários não puderam ser lidos.";
const MIXED_CURRENCY = "Contas em moedas diferentes não são somadas.";
const MIXED_EVENTS = "As contas usam eventos diferentes para esse resultado, então não são somadas.";

type Insights = NonNullable<AccountSnapshot["insights"]>;

/** The indicator with its numbers taken out, saying why there is none. */
function withoutData(base: Widget, why: string): Widget {
  const marked = { ...base, unavailable: why };
  switch (marked.kind) {
    case "metric":
      return { ...marked, value: 0, previous: null, comparison: false };
    case "bar":
    case "line":
      return { ...marked, points: [] };
    case "groupedBar":
      return { ...marked, categories: [], series: [] };
    case "pie":
      return { ...marked, slices: [] };
    case "table":
      return { ...marked, rows: [] };
    case "posts":
      return { ...marked, rows: [] };
    case "stories":
      return { ...marked, items: [] };
  }
}

const spendDailyPoints = (daily: DailyPoint[] | undefined, pick: (d: DailyPoint) => number) => (daily ? daily.map((d) => ({ label: dmy(d.date), value: pick(d) })) : null);

interface Picked {
  value: number | null;
  previous: number | null;
  why?: string;
}

/** The value of one metric key from one set of insights (and the previous period's), or why not. */
function pickMetric(key: string, now: Insights, before: Insights | undefined): Picked | null {
  const both = (f: (i: Insights) => number | null | undefined, why?: string): Picked => {
    const v = f(now);
    const p = before ? f(before) : null;
    return { value: typeof v === "number" ? v : null, previous: typeof p === "number" ? p : null, why: typeof v === "number" ? undefined : why };
  };
  switch (key) {
    case "spend":
      return both((i) => i.spend);
    case "impressions":
      return both((i) => i.impressions);
    case "reach":
      return both((i) => i.reach);
    case "clicks":
      return both((i) => i.clicks);
    case "ctr":
      return both((i) => i.ctr);
    case "cpc":
      return both((i) => i.cpc);
    case "frequency":
      return both((i) => (i.reach > 0 ? Math.round((i.impressions / i.reach) * 100) / 100 : null), "Sem alcance no período.");
    case "leads":
      return both((i) => i.leads);
    case "cost_per_lead":
      return both((i) => cplOf(i.spend, i.leads), NO_LEADS);
    case "purchases":
      return both((i) => i.purchases, NO_PURCHASE);
    case "purchase_value":
      return both((i) => i.purchaseValue, NO_PURCHASE);
    case "roas":
      return both((i) => (typeof i.purchaseValue === "number" && i.spend > 0 ? Math.round((i.purchaseValue / i.spend) * 100) / 100 : null), NO_PURCHASE);
    case "cost_per_purchase":
      return both((i) => (typeof i.purchases === "number" && i.purchases > 0 ? Math.round((i.spend / i.purchases) * 100) / 100 : null), NO_PURCHASE);
    default:
      return null;
  }
}

const metricOf = (base: Widget, p: Picked): Widget => {
  if (p.value === null || base.kind !== "metric") return withoutData(base, p.why ?? NOT_COLLECTED);
  return { ...base, value: p.value, previous: p.previous, comparison: p.previous !== null, networks: ["meta_ads"] };
};

const LEAD_KEYS = new Set(["leads", "cost_per_lead"]);
const PURCHASE_KEYS = new Set(["purchases", "purchase_value", "roas", "cost_per_purchase"]);

/** Says in the indicator's own description which event counted it, so the choice is visible and kept. */
function withEvent(w: Widget, key: string, i: Insights): Widget {
  const event = LEAD_KEYS.has(key) ? i.leadEvent : PURCHASE_KEYS.has(key) ? i.purchaseEvent : null;
  return event && !w.unavailable ? { ...w, description: `${w.description} [Evento contado: ${event}. ${attributionLabel(i.attribution)}]` } : w;
}

/** One Meta Ads indicator of one account, or null when the key is not in the catalog. */
export function metaWidget(key: string, snap: AccountSnapshot, ctx: { id: string; range: Range }): Widget | null {
  const base = catalogEntry("meta_ads", key)?.make({ id: ctx.id, range: ctx.range, seed: "real" });
  if (!base || !snap.insights) return null;
  if (base.kind === "metric") {
    const p = pickMetric(key, snap.insights, snap.previous);
    if (!p) return withoutData(base, NOT_COLLECTED);
    const w = metricOf(base, p);
    return withEvent(w.kind === "metric" ? { ...w, currency: snap.currency ?? undefined } : w, key, snap.insights);
  }
  if (key === "spend_daily" || key === "clicks_daily") {
    const points = spendDailyPoints(snap.daily, key === "spend_daily" ? (d) => d.spend : (d) => d.clicks);
    return points && (base.kind === "line" || base.kind === "bar") ? { ...base, points } : withoutData(base, NO_DAILY);
  }
  return withoutData(base, NOT_COLLECTED);
}

/** Totals of the Bloco Personalizado that Meta Ads alone can feed, over every readable account. */
const CUSTOM_FROM_META: Record<string, string> = { total_spend: "spend", total_impressions: "impressions", total_clicks: "clicks", total_leads: "leads" };

function sumInsights(list: readonly Insights[]): Insights {
  const add = (f: (i: Insights) => number) => list.reduce((a, i) => a + f(i), 0);
  const spend = add((i) => i.spend);
  const leads = list.some((i) => i.leads === undefined) ? undefined : add((i) => i.leads ?? 0);
  return { spend, impressions: add((i) => i.impressions), reach: add((i) => i.reach), clicks: add((i) => i.clicks), ctr: 0, cpc: 0, cpm: 0, leads, conversations: list.some((i) => i.conversations === undefined) ? undefined : add((i) => i.conversations ?? 0), costPerLead: leads === undefined ? undefined : leads > 0 ? Math.round((spend / leads) * 100) / 100 : 0 };
}

export interface RealDocResult {
  doc: ReportDoc;
  /** Networks of the template that got no block because they are not real yet. */
  skipped: string[];
  /** Linked accounts that could not be read (their name and the reason code). */
  unreadable: { account: string; error: string }[];
}

/**
 * The document of a template for a client's real Meta Ads accounts. `accounts` are the
 * snapshots of every linked account (readable ones feed the blocks). Blocks: the custom
 * block (totals Meta can feed, only inside one currency), then one block per readable
 * Meta Ads account. Other networks of the layout go to `skipped`.
 */
export function buildRealDoc(opts: { layout: TemplateLayout; accounts: readonly AccountSnapshot[]; range: Range; newId: IdMaker; hideCover?: boolean }): RealDocResult {
  const { layout, accounts, range, newId } = opts;
  const readable = accounts.filter((a) => a.insights);
  const unreadable = accounts.filter((a) => !a.insights).map((a) => ({ account: a.name, error: a.error ?? "request_failed" }));
  const layoutNetworks = [...new Set([...layout.blocks.map((b) => b.network), ...layout.custom.flatMap((c) => c.networks)])];
  const skipped = layoutNetworks.filter((n) => n !== "meta_ads");
  const blocks: Block[] = [];

  // Custom block.
  const items = layout.custom.filter((c) => c.networks.includes("meta_ads") && CUSTOM_FROM_META[c.key]);
  if (items.length > 0 && readable.length > 0) {
    const mixed = new Set(readable.map((a) => a.currency ?? "?")).size > 1;
    const now = sumInsights(readable.map((a) => a.insights!));
    const hasPrev = readable.every((a) => a.previous);
    const before = hasPrev ? sumInsights(readable.map((a) => a.previous!)) : undefined;
    const widgets: Widget[] = [];
    for (const it of items) {
      const base = catalogEntry("custom", it.key)?.make({ id: newId("w"), range, seed: "real" });
      if (!base) continue;
      const meta = CUSTOM_FROM_META[it.key];
      if (mixed && meta === "spend") {
        widgets.push(withoutData(base, MIXED_CURRENCY));
        continue;
      }
      if (meta === "leads" && new Set(readable.map((a) => a.insights!.leadEvent).filter((e): e is string => !!e)).size > 1) {
        widgets.push(withoutData(base, MIXED_EVENTS));
        continue;
      }
      const p = pickMetric(meta, now, before);
      widgets.push(p ? { ...(metricOf(base, p) as MetricWidget), currency: readable[0]?.currency ?? undefined, networks: ["meta_ads"] } : withoutData(base, NOT_COLLECTED));
    }
    if (widgets.length > 0) blocks.push({ id: newId("b"), kind: "custom", title: "Bloco Personalizado", subtitle: "Resumo consolidado dos resultados da rede", analysis: "", hidden: false, widgets });
  }

  // One block per readable Meta Ads account.
  const keys = layout.blocks.find((b) => b.network === "meta_ads")?.keys ?? defaultKeys("meta_ads");
  const wantsMeta = layout.blocks.some((b) => b.network === "meta_ads") || layoutNetworks.length === 0;
  if (wantsMeta) {
    for (const snap of readable) {
      const widgets = keys.map((k) => metaWidget(k, snap, { id: newId("w"), range })).filter((w): w is Widget => w !== null);
      if (widgets.length > 0) blocks.push({ id: newId("b"), kind: "network", network: "meta_ads", title: NETWORK_LABEL.meta_ads ?? "Meta Ads", subtitle: snap.name, accountId: snap.id, analysis: "", hidden: false, widgets });
    }
  }
  return { doc: { version: 1, demo: false, cover: { hidden: opts.hideCover ?? false, subtitle: "Análise de desempenho", analysis: "" }, blocks }, skipped, unreadable };
}

/** The indicator with its numbers taken out and a reason: used for what an editor adds to a real document and for what could not be refreshed. */
export const unavailableWidget = withoutData;

export const NO_SOURCE = "Esta rede ainda não tem fonte de dados real.";
export const NOT_READ = "Não foi possível ler esta conta para o período. O número anterior não é mostrado como se fosse deste período.";

/** A block for a network added in the editor of a real document: its usual indicators, all without numbers. */
export function emptyRealBlock(demoBlock: Block): Block {
  return { ...demoBlock, widgets: demoBlock.widgets.map((w) => withoutData(w, NO_SOURCE)) };
}

export type Fresh = { widget: Widget } | { unavailable: string } | null;

const EVENT_NOTE = / \[Evento contado:[^\]]*\]$/;

/**
 * The same indicator with new numbers and everything a person set kept: id, key, title, text,
 * size, highlight, own period, comparison and display choices. `fresh` supplies the numbers
 * only; `null` leaves the indicator as it is.
 */
export function applyFresh(old: Widget, fresh: Fresh): Widget {
  if (fresh === null) return old;
  const { unavailable: _u, ...clean } = old as Widget & { unavailable?: string };
  void _u;
  if ("unavailable" in fresh) return withoutData(clean as Widget, fresh.unavailable);
  const f = fresh.widget;
  if (f.unavailable) return withoutData(clean as Widget, f.unavailable);
  const note = f.description.match(EVENT_NOTE)?.[0] ?? "";
  const description = `${old.description.replace(EVENT_NOTE, "")}${note}`;
  if (clean.kind === "metric" && f.kind === "metric") return { ...clean, description, currency: f.currency, value: f.value, previous: f.previous, comparison: clean.comparison && f.previous !== null };
  if ((clean.kind === "line" || clean.kind === "bar") && (f.kind === "line" || f.kind === "bar")) return { ...clean, description, points: f.points };
  return withoutData(clean as Widget, NOT_COLLECTED);
}

/**
 * New numbers and period for a document, keeping every edit: the order of the blocks and of
 * the indicators, titles, texts and analyses, hidden blocks, sizes, highlights and the
 * indicators a person removed or added. Only the numbers inside the indicators change, and
 * the indicators with a period of their own keep theirs. `produce` answers, per indicator, the
 * fresh numbers, a reason there are none, or null (leave it).
 */
export function refreshPreserving(doc: ReportDoc, produce: (block: Block, widget: Widget) => Fresh): ReportDoc {
  return {
    ...doc,
    blocks: doc.blocks.map((block) => ({
      ...block,
      widgets: block.widgets.map((w) => (w.period !== null ? w : applyFresh(w, produce(block, w)))),
    })),
  };
}

/**
 * The refresh of a real document for a period: Meta Ads blocks take the numbers of their own
 * account (by id), the custom block those of all the readable accounts, anything else (a network
 * with no real source) goes without numbers. A block whose account could not be read goes without
 * numbers too, with the reason, instead of keeping the old period's.
 */
export function refreshRealDoc(doc: ReportDoc, accounts: readonly AccountSnapshot[], range: Range): { doc: ReportDoc; unreadable: string[] } {
  const readable = accounts.filter((a) => a.insights);
  const byId = new Map(readable.map((a) => [a.id, a]));
  const unreadable = new Set<string>();
  const mixed = new Set(readable.map((a) => a.currency ?? "?")).size > 1;
  const now = readable.length > 0 ? sumInsights(readable.map((a) => a.insights!)) : null;
  const before = readable.length > 0 && readable.every((a) => a.previous) ? sumInsights(readable.map((a) => a.previous!)) : undefined;

  const out = refreshPreserving(doc, (block, w) => {
    if (block.kind === "custom") {
      const meta = w.key ? CUSTOM_FROM_META[w.key] : undefined;
      if (!meta || !now) return { unavailable: meta ? NOT_READ : NOT_COLLECTED };
      if (mixed && meta === "spend") return { unavailable: MIXED_CURRENCY };
      if (meta === "leads" && new Set(readable.map((a) => a.insights!.leadEvent).filter((e): e is string => !!e)).size > 1) return { unavailable: MIXED_EVENTS };
      const p = pickMetric(meta, now, before);
      return p && p.value !== null && w.kind === "metric" ? { widget: { ...w, currency: readable[0]?.currency ?? undefined, value: p.value, previous: p.previous, comparison: w.comparison && p.previous !== null } } : { unavailable: p?.why ?? NOT_COLLECTED };
    }
    if (block.network !== "meta_ads" || !block.accountId) return { unavailable: NO_SOURCE };
    const snap = byId.get(block.accountId);
    if (!snap) {
      unreadable.add(block.subtitle);
      return { unavailable: NOT_READ };
    }
    if (!w.key) return { unavailable: NOT_COLLECTED };
    const fresh = metaWidget(w.key, snap, { id: w.id, range });
    return fresh ? { widget: fresh } : { unavailable: NOT_COLLECTED };
  });
  return { doc: out, unreadable: [...unreadable] };
}
