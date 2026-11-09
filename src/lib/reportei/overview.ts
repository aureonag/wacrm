// The general dashboard of Reportei → Dashboards: what stands out across the clients
// (good moves), who needs a look (bad moves), the lead-generation clients and the totals.
//
// Each client is reduced to a few READINGS (metric, value now, value before). A reading
// whose value is null is not zero: it says why it is unavailable (no integration, partial
// read, failure, mixed currency, no base…). Two sources produce them: the real one, on the
// server (overview-real.ts, from the Meta accounts linked to each client), and `demoOverview`,
// made-up numbers that only exist for the clearly marked preview. Classification and totals
// below never know which one fed them.

import { rng } from "./doc-catalog";

export type ReadingFormat = "money" | "percent" | "number" | "ratio";

/** Why a number is not there. None of these is a zero. */
export type Why = "no_integration" | "partial" | "failed" | "mixed_currency" | "mixed_events" | "no_events" | "no_base" | "not_configured";

export const WHY_TEXT: Record<Why, string> = {
  no_integration: "Sem integração ligada",
  partial: "Leitura incompleta: alguma conta não respondeu",
  failed: "Falha ao ler a Meta",
  mixed_currency: "Contas em moedas diferentes não são somadas",
  mixed_events: "As contas usam eventos diferentes para esse resultado, então não são somadas",
  no_events: "A conta não registrou esse evento",
  no_base: "Sem base de comparação",
  not_configured: "Tipo do cliente não configurado",
};

export interface Reading {
  currency?: string | null;
  key: string;
  label: string;
  /** Null: unavailable (see `why`). Never a made-up zero. */
  value: number | null;
  previous: number | null;
  format: ReadingFormat;
  /** Whether a higher number is better (ROAS, leads) or worse (CPL, CPA). */
  upIsGood: boolean;
  /** Context only (investment): it moves, but is never good or bad by itself. */
  neutral?: boolean;
  why?: Why;
}

/** What the client sells. Decides which metrics judge it. */
export type Segment = "leads" | "ecommerce" | "mixed";

export const SEGMENT_LABEL: Record<Segment, string> = { leads: "Geração de leads", ecommerce: "E-commerce", mixed: "Misto" };

export type ClientStatus = "ok" | "no_integration" | "partial" | "failed";

export interface ClientReadings {
  clientId: string;
  name: string;
  logoUrl: string | null;
  /** Null: not configured. Nothing is inferred from the name and nothing is drawn at random. */
  segment: Segment | null;
  status: ClientStatus;
  /** The money of this client's accounts, null when it has none or they differ. */
  currency: string | null;
  readings: Reading[];
}

export interface Mover {
  clientId: string;
  name: string;
  logoUrl: string | null;
  reading: Reading;
  /** Percent change against the previous period (can be negative). */
  delta: number;
  /** The strongest move the other way, so a good number never hides a bad one (null when there is none). */
  contrary: { label: string; delta: number } | null;
}

export interface Overview {
  highlights: Mover[];
  attention: Mover[];
}

/**
 * The rule behind "Em destaque" and "Pontos de atenção". It is the first version of
 * Aureon's own rule (not a rule found in Reportei) and it is shown on the screen.
 */
export const RULES = {
  version: 1,
  /**
   * The limits below (percentage, volume, cards) are PROVISIONAL: proposed by us, not yet approved
   * nor configurable per client or metric. The screen says so until that changes.
   */
  provisional: true,
  /** How far a metric has to move, in the good or bad direction, to count (percent). */
  threshold: 10,
  /** Cards per section. */
  limit: 6,
  /** Smallest volume, in both periods, for a metric to be judged: below it the number is noise. */
  minVolume: { leads: 10, purchases: 5 },
} as const;

export const MOVE_THRESHOLD = RULES.threshold;
export const SECTION_LIMIT = RULES.limit;

/** The metrics that judge each kind of client. Spend, CTR and CPC are context, not verdicts. */
const JUDGED: Record<Segment, readonly string[]> = {
  leads: ["leads", "cpl"],
  ecommerce: ["purchases", "revenue", "roas", "cpa"],
  mixed: ["leads", "cpl", "purchases", "revenue", "roas", "cpa"],
};

/** Percent change against the previous period; null when either side is missing or the base is zero. */
export function deltaPct(r: Pick<Reading, "value" | "previous">): number | null {
  if (r.value === null || r.previous === null) return null;
  if (!Number.isFinite(r.value) || !Number.isFinite(r.previous) || r.previous === 0) return null;
  return ((r.value - r.previous) / Math.abs(r.previous)) * 100;
}

/** The change in terms of "better" (positive) or "worse" (negative); null for context metrics and missing bases. */
export function goodness(r: Reading): number | null {
  if (r.neutral) return null;
  const d = deltaPct(r);
  return d === null ? null : r.upIsGood ? d : -d;
}

/** A result from nothing to something: there is no percentage for it, only "novo". */
export function isNewResult(r: Pick<Reading, "value" | "previous">): boolean {
  return r.previous === 0 && r.value !== null && r.value > 0;
}

const find = (c: ClientReadings, key: string) => c.readings.find((r) => r.key === key);

/** Enough volume, in both periods, for this metric to be judged. */
function enoughVolume(c: ClientReadings, key: string): boolean {
  const lead = key === "leads" || key === "cpl";
  const base = lead ? find(c, "leads") : find(c, "purchases");
  const min = lead ? RULES.minVolume.leads : RULES.minVolume.purchases;
  if (!base || base.value === null || base.previous === null) return false;
  return Math.min(base.value, base.previous) >= min;
}

/**
 * Highlights: clients whose best result metric improved by at least the threshold.
 * Attention: clients whose worst one got worse by at least the threshold.
 * Only fully read clients of a configured segment are judged, only on the metrics of
 * that segment and only with enough volume; everything else is a pending item, not a
 * verdict. One card per client (its strongest move); the opposite move, when there is
 * one, goes in the card as `contrary`.
 */
export function classify(clients: readonly ClientReadings[], limit: number = RULES.limit, threshold: number = RULES.threshold): Overview {
  const highlights: Mover[] = [];
  const attention: Mover[] = [];
  for (const c of clients) {
    if (c.status !== "ok" || c.segment === null) continue;
    let best: { r: Reading; g: number } | null = null;
    let worst: { r: Reading; g: number } | null = null;
    for (const key of JUDGED[c.segment]) {
      const r = find(c, key);
      if (!r || !enoughVolume(c, key)) continue;
      const g = goodness(r);
      if (g === null) continue;
      if (!best || g > best.g) best = { r, g };
      if (!worst || g < worst.g) worst = { r, g };
    }
    const up = best && best.g >= threshold ? best : null;
    const down = worst && worst.g <= -threshold ? worst : null;
    const pick = up && down ? (up.g >= -down.g ? "up" : "down") : up ? "up" : down ? "down" : null;
    if (pick === "up" && up) highlights.push({ clientId: c.clientId, name: c.name, logoUrl: c.logoUrl, reading: up.r, delta: deltaPct(up.r) ?? 0, contrary: down ? { label: down.r.label, delta: deltaPct(down.r) ?? 0 } : null });
    if (pick === "down" && down) attention.push({ clientId: c.clientId, name: c.name, logoUrl: c.logoUrl, reading: down.r, delta: deltaPct(down.r) ?? 0, contrary: up ? { label: up.r.label, delta: deltaPct(up.r) ?? 0 } : null });
  }
  const strength = (m: Mover) => Math.abs(goodness(m.reading) ?? 0);
  highlights.sort((a, b) => strength(b) - strength(a));
  attention.sort((a, b) => strength(b) - strength(a));
  return { highlights: highlights.slice(0, limit), attention: attention.slice(0, limit) };
}

export interface Pending {
  /** Clients that cannot be judged and why. */
  noIntegration: number;
  failed: number;
  partial: number;
  notConfigured: number;
}

/** What is missing before every client can be judged. Pure. */
export function pendingOf(clients: readonly ClientReadings[]): Pending {
  return {
    noIntegration: clients.filter((c) => c.status === "no_integration").length,
    failed: clients.filter((c) => c.status === "failed").length,
    partial: clients.filter((c) => c.status === "partial").length,
    notConfigured: clients.filter((c) => c.status === "ok" && c.segment === null).length,
  };
}

export interface LeadRow {
  clientId: string;
  name: string;
  logoUrl: string | null;
  leads: Reading;
  /** Purchase value attributed by Meta; a null value = the account has no purchase event (leads do not depend on it). */
  revenue: Reading;
  cpl: Reading | null;
}

/** The lead-generation (and mixed) clients with their leads, most leads first. A client with leads but no revenue still shows. */
export function leadRows(clients: readonly ClientReadings[], limit = 20): LeadRow[] {
  const rows: LeadRow[] = [];
  for (const c of clients) {
    if (c.status !== "ok" || (c.segment !== "leads" && c.segment !== "mixed")) continue;
    const leads = find(c, "leads");
    if (!leads || leads.value === null) continue;
    rows.push({
      clientId: c.clientId,
      name: c.name,
      logoUrl: c.logoUrl,
      leads,
      revenue: find(c, "revenue") ?? { key: "revenue", label: "Faturamento", value: null, previous: null, format: "money", upIsGood: true, why: "no_events" },
      cpl: find(c, "cpl") ?? null,
    });
  }
  return rows.sort((a, b) => (b.leads.value ?? 0) - (a.leads.value ?? 0)).slice(0, limit);
}

export interface Totals {
  spend: Reading;
  revenue: Reading;
  leads: Reading;
  roas: Reading;
  cpl: Reading;
  /** How many clients each number covers, so a partial sum is never passed off as the whole. */
  coverage: { spend: number; revenue: number; leads: number; total: number };
}

const unavailable = (key: string, label: string, format: ReadingFormat, upIsGood: boolean, why: Why, neutral = false): Reading => ({ key, label, value: null, previous: null, format, upIsGood, why, ...(neutral ? { neutral: true } : {}) });

const sumField = (list: readonly Reading[], field: "value" | "previous") => list.reduce((a, r) => a + (r[field] ?? 0), 0);
const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Totals over the fully read clients. Money is added only inside one currency; ROAS and CPL
 * are recomputed from sums over the same clients (never averaged), and each number says how
 * many clients it covers. Lead totals count the lead-generation clients only.
 */
export function totals(clients: readonly ClientReadings[]): Totals {
  const ok = clients.filter((c) => c.status === "ok");
  const total = clients.length;
  const has = (r: Reading | undefined): r is Reading => !!r && r.value !== null;

  // Spend: every fully read client, one currency only.
  const spendRows = ok.map((c) => ({ c, r: find(c, "spend") })).filter((x): x is { c: ClientReadings; r: Reading } => has(x.r));
  const spendMixed = new Set(spendRows.map((x) => x.c.currency ?? "?")).size > 1 || spendRows.some((x) => x.c.currency === null);
  const spend: Reading =
    spendRows.length === 0
      ? unavailable("spend", "Investimento total", "money", true, "no_integration", true)
      : spendMixed
        ? unavailable("spend", "Investimento total", "money", true, "mixed_currency", true)
        : { key: "spend", label: "Investimento total", value: r2(sumField(spendRows.map((x) => x.r), "value")), previous: r2(sumField(spendRows.map((x) => x.r), "previous")), format: "money", upIsGood: true, neutral: true };

  // Revenue and ROAS: the clients that have a purchase value, with their own spend, in one currency.
  const revRows = ok.map((c) => ({ c, rev: find(c, "revenue"), sp: find(c, "spend") })).filter((x) => has(x.rev) && has(x.sp));
  const revMixed = new Set(revRows.map((x) => x.c.currency ?? "?")).size > 1 || revRows.some((x) => x.c.currency === null);
  let revenue = unavailable("revenue", "Faturamento (atribuído pela Meta)", "money", true, revRows.length === 0 ? "no_events" : "mixed_currency");
  let roas = unavailable("roas", "ROAS médio", "ratio", true, revRows.length === 0 ? "no_events" : "mixed_currency");
  if (revRows.length > 0 && !revMixed) {
    const rv = sumField(revRows.map((x) => x.rev!), "value");
    const rp = sumField(revRows.map((x) => x.rev!), "previous");
    const sv = sumField(revRows.map((x) => x.sp!), "value");
    const sp = sumField(revRows.map((x) => x.sp!), "previous");
    revenue = { key: "revenue", label: "Faturamento (atribuído pela Meta)", value: r2(rv), previous: r2(rp), format: "money", upIsGood: true };
    const now = ratio(rv, sv);
    const before = ratio(rp, sp);
    roas = now === null ? unavailable("roas", "ROAS médio", "ratio", true, "no_base") : { key: "roas", label: "ROAS médio", value: r2(now), previous: before === null ? null : r2(before), format: "ratio", upIsGood: true };
  }

  // Leads and CPL: lead-generation clients only, same population for both.
  const leadRowsOk = ok.filter((c) => c.segment === "leads" || c.segment === "mixed").map((c) => ({ c, l: find(c, "leads"), sp: find(c, "spend") })).filter((x) => has(x.l) && has(x.sp));
  const leadMixed = new Set(leadRowsOk.map((x) => x.c.currency ?? "?")).size > 1 || leadRowsOk.some((x) => x.c.currency === null);
  const leads: Reading =
    leadRowsOk.length === 0 ? unavailable("leads", "Leads gerados", "number", true, "not_configured") : { key: "leads", label: "Leads gerados", value: sumField(leadRowsOk.map((x) => x.l!), "value"), previous: sumField(leadRowsOk.map((x) => x.l!), "previous"), format: "number", upIsGood: true };
  let cpl = unavailable("cpl", "CPL médio", "money", false, leadRowsOk.length === 0 ? "not_configured" : "mixed_currency");
  if (leadRowsOk.length > 0 && !leadMixed) {
    const now = ratio(sumField(leadRowsOk.map((x) => x.sp!), "value"), sumField(leadRowsOk.map((x) => x.l!), "value"));
    const before = ratio(sumField(leadRowsOk.map((x) => x.sp!), "previous"), sumField(leadRowsOk.map((x) => x.l!), "previous"));
    cpl = now === null ? unavailable("cpl", "CPL médio", "money", false, "no_base") : { key: "cpl", label: "CPL médio", value: r2(now), previous: before === null ? null : r2(before), format: "money", upIsGood: false };
  }

  spend.currency = spendMixed ? null : spendRows[0]?.c.currency;
  revenue.currency = revMixed ? null : revRows[0]?.c.currency;
  cpl.currency = leadMixed ? null : leadRowsOk[0]?.c.currency;
  if (spendRows.some((x) => x.r.previous === null)) spend.previous = null;
  if (revRows.some((x) => x.rev!.previous === null || x.sp!.previous === null)) {
    revenue.previous = null;
    roas.previous = null;
  }
  if (leadRowsOk.some((x) => x.l!.previous === null || x.sp!.previous === null)) {
    leads.previous = null;
    cpl.previous = null;
  }
  return { spend, revenue, leads, roas, cpl, coverage: { spend: spendRows.length, revenue: revRows.length, leads: leadRowsOk.length, total } };
}

// ---- the daily series of the month -----------------------------------------------------

export interface DayPoint {
  date: string;
  value: number;
}

/** A series with the same number of days before it, or the reason it does not exist. Never invented. */
export interface MonthLine {
  currency?: string | null;
  now: DayPoint[] | null;
  before: DayPoint[] | null;
  why?: Why;
  /** Clients that fed the series, of those with an integration. */
  covered: number;
  total: number;
}

export interface MonthSeries {
  month: { since: string; until: string };
  before: { since: string; until: string };
  spend: MonthLine;
  revenue: MonthLine;
}

/** Day rows of several accounts summed by date; a day with no row is simply absent. Pure. */
export function sumByDate(lists: readonly (readonly DayPoint[])[]): DayPoint[] {
  const by = new Map<string, number>();
  for (const list of lists) for (const p of list) by.set(p.date, (by.get(p.date) ?? 0) + p.value);
  return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value: r2(value) }));
}

/** Total of a series. Pure. */
export const seriesTotal = (points: readonly DayPoint[]) => r2(points.reduce((a, p) => a + p.value, 0));

// ---- demonstration only ----------------------------------------------------------------

const DAY = 24 * 60 * 60 * 1000;

/**
 * A total spread over the days of a range, only for the preview with made-up numbers. The
 * real series come from each account's daily data and are never built this way.
 */
export function dailySeries(total: number, range: { since: string; until: string }, seed: string): DayPoint[] {
  const dates: string[] = [];
  for (let t = new Date(range.since + "T00:00:00Z").getTime(); t <= new Date(range.until + "T00:00:00Z").getTime() && dates.length < 400; t += DAY) {
    dates.push(new Date(t).toISOString().slice(0, 10));
  }
  const rand = rng(seed);
  const weights = dates.map((_, i) => 0.55 + rand() * 0.9 + 0.25 * Math.sin(i / 2.3));
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  return dates.map((date, i) => ({ date, value: r2((total * weights[i]) / sum) }));
}

/** Where the demonstration readings come from. */
export interface OverviewSource {
  readonly name: string;
  /** True when the numbers are not real. */
  readonly demo: boolean;
  readings(clients: readonly { id: string; name: string; logoUrl: string | null }[], range: { since: string; until: string }): ClientReadings[];
}

/** Made-up readings (steady for a client and period). Only ever used by the preview, which says so on screen. */
export const demoOverview: OverviewSource = {
  name: "demo",
  demo: true,
  readings: (clients, range) =>
    clients.map((c) => {
      const r = rng(`overview:${c.id}:${range.since}:${range.until}`);
      const between = (lo: number, hi: number) => lo + r() * (hi - lo);
      const grew = () => 1 + (r() - 0.62) * 0.7;
      const cheaper = () => 1 + (r() - 0.38) * 0.7;
      const spend = between(3000, 42000);
      const roas = between(1.6, 6.2);
      const cpl = between(22, 120);
      const cpc = between(0.5, 3.2);
      const ctr = between(0.8, 3.6);
      const prev = { spend: spend * grew(), roas: roas * grew(), cpl: cpl * cheaper(), cpc: cpc * cheaper(), ctr: ctr * grew() };
      const mk = (key: string, label: string, value: number, previous: number, format: ReadingFormat, upIsGood: boolean, neutral = false): Reading => ({ key, label, value: r2(value), previous: r2(previous), format, upIsGood, ...(neutral ? { neutral: true } : {}) });
      const segment: Segment = rng("segment:" + c.id)() < 0.75 ? "leads" : "ecommerce";
      const purchases = Math.max(Math.round(spend / between(60, 200)), 1);
      const prevPurchases = Math.max(Math.round(purchases / grew()), 1);
      return {
        clientId: c.id,
        name: c.name,
        logoUrl: c.logoUrl,
        segment,
        status: "ok" as const,
        currency: "BRL",
        readings: [
          mk("spend", "Investimento", spend, prev.spend, "money", true, true),
          mk("revenue", "Faturamento", spend * roas, prev.spend * prev.roas, "money", true),
          mk("leads", "Leads", Math.round(spend / cpl), Math.round(prev.spend / prev.cpl), "number", true),
          mk("purchases", "Compras", purchases, prevPurchases, "number", true),
          mk("roas", "ROAS", roas, prev.roas, "ratio", true),
          mk("cpl", "CPL", cpl, prev.cpl, "money", false),
          mk("cpa", "CPA", spend / purchases, prev.spend / prevPurchases, "money", false),
          mk("cpc", "CPC", cpc, prev.cpc, "money", false, true),
          mk("ctr", "CTR", ctr, prev.ctr, "percent", true, true),
        ],
      };
    }),
};
