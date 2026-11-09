// The real source of the general dashboard: reads the Meta accounts linked to each
// client (through the company connection of each link) and returns readings with their
// states. Server-only. Nothing here invents a number: a client or account that cannot be
// read says so, and a daily series that cannot exist is left out with its reason.

import type { AccountContext } from "@/lib/auth/account";
import { mapLimit, TtlCache } from "./dashboard";
import { accountToday, rangeForAccount } from "./account-time";
import { fetchDayRows, MetaAdsError, type EventConfig } from "./meta-ads";
import { getCompanyConnection } from "./meta-connection";
import { readingsOf } from "./overview-readings";
import { sumByDate, type ClientStatus, type DayPoint, type MonthLine, type MonthSeries, type Reading, type Segment, type Why } from "./overview";
import { collectAccountSnapshots } from "./report-data";

type Ctx = Pick<AccountContext, "supabase" | "accountId">;
type Span = { since: string; until: string };

export interface ClientOverviewRow {
  clientId: string;
  segment: Segment | null;
  status: ClientStatus;
  currency: string | null;
  readings: Reading[];
}

export interface OverviewPayload {
  demo: false;
  range: Span;
  before: Span | null;
  clients: ClientOverviewRow[];
  month: MonthSeries;
  generatedAt: string;
}

const SEGMENTS: readonly string[] = ["leads", "ecommerce", "mixed"];

interface ClientSettings {
  segment: Segment | null;
  events: EventConfig;
}

/** The segment and the pinned events of each client. Without the settings (nothing saved) a client is "not configured" and uses the canonical events; never guessed. */
async function loadSettings(ctx: Ctx): Promise<Map<string, ClientSettings>> {
  const out = new Map<string, ClientSettings>();
  const res = await ctx.supabase.from("reportei_client_settings").select("client_id, segment, lead_event, purchase_event").eq("account_id", ctx.accountId).limit(10000);
  if (res.error) return out;
  for (const r of res.data ?? []) {
    out.set(r.client_id as string, {
      segment: typeof r.segment === "string" && SEGMENTS.includes(r.segment) ? (r.segment as Segment) : null,
      events: { lead: (r.lead_event as string | null) ?? null, purchase: (r.purchase_event as string | null) ?? null },
    });
  }
  return out;
}

export interface LinkRow {
  clientId: string;
  accountId: string;
  currency: string | null;
  timezone: string | null;
  connectionId: string | null;
  campaignIds: string[] | null;
  attributionWindows: string[] | null;
}

const LINK_COLUMNS = "client_id, external_account_id, currency, timezone, connection_id, campaign_ids";

/** The links of every client. `attribution_windows` exists only after migration 181: without it, Meta's default attribution is used. */
async function loadLinks(ctx: Ctx): Promise<LinkRow[]> {
  const query = (columns: string) => ctx.supabase.from("ad_integrations").select(columns).eq("account_id", ctx.accountId).eq("provider", "meta_ads").limit(10000);
  let res = await query(`${LINK_COLUMNS}, attribution_windows`);
  if (res.error && res.error.code === "42703") res = await query(LINK_COLUMNS);
  if (res.error) throw new Error(`Failed to load integrations: ${res.error.message}`);
  return ((res.data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
    clientId: r.client_id as string,
    accountId: r.external_account_id as string,
    currency: (r.currency as string | null) ?? null,
    timezone: (r.timezone as string | null) ?? null,
    connectionId: (r.connection_id as string | null) ?? null,
    campaignIds: ((r.campaign_ids as string[] | null) ?? []).length > 0 ? (r.campaign_ids as string[]) : null,
    attributionWindows: Array.isArray(r.attribution_windows) && r.attribution_windows.length > 0 ? (r.attribution_windows as string[]) : null,
  }));
}

/** The same number of days as `fit` (the part of the month the account can answer), counted from the start of the month before. */
function beforeForFit(month: Span, fit: Span, before: Span): Span {
  const days = Math.round((Date.parse(`${fit.until}T00:00:00Z`) - Date.parse(`${month.since}T00:00:00Z`)) / 86_400_000);
  const end = new Date(Date.parse(`${before.since}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  return { since: before.since, until: end < before.until ? end : before.until };
}

/** One line of a daily chart: the sum of the days of every account that could be read, with how many were. */
function line(now: DayPoint[][], before: DayPoint[][], covered: number, total: number, why?: Why): MonthLine {
  if (now.length === 0) return { now: null, before: null, why: why ?? "failed", covered, total };
  return { now: sumByDate(now), before: before.length === now.length ? sumByDate(before) : null, covered, total };
}

/**
 * The current month so far and the same days of the month before, day by day, from the
 * accounts' own daily data. Spend is added only inside one currency. Revenue only counts
 * accounts that recorded a purchase event; with none, it is unavailable (not zero).
 */
export async function buildMonthSeries(ctx: Ctx, links: readonly LinkRow[], month: Span, before: Span, events: ReadonlyMap<string, EventConfig> = new Map(), now: Date = new Date()): Promise<MonthSeries> {
  // One token per connection, taken one at a time (a decryption or a renewal each), before any Meta read.
  const tokenByConnection = new Map<string, string | null>();
  for (const id of new Set(links.map((l) => l.connectionId).filter((c): c is string => !!c))) {
    tokenByConnection.set(id, (await getCompanyConnection(ctx.accountId, id))?.token ?? null);
  }

  type Read = { link: LinkRow; now: Awaited<ReturnType<typeof fetchDayRows>> | null; before: Awaited<ReturnType<typeof fetchDayRows>> | null };
  const reads: Read[] = [];
  await mapLimit(links, 3, async (link) => {
    const token = link.connectionId ? tokenByConnection.get(link.connectionId) : null;
    if (!token) return void reads.push({ link, now: null, before: null });
    // Each account is read up to its own today, and the month before for the same number of days.
    const fit = rangeForAccount(month, accountToday(link.timezone, now));
    if (fit.empty) return void reads.push({ link, now: null, before: null });
    const prevSpan = fit.clamped ? beforeForFit(month, fit.range, before) : before;
    const options = { events: events.get(link.clientId) ?? {}, attributionWindows: link.attributionWindows };
    try {
      const [cur, prev] = await Promise.all([fetchDayRows(token, link.accountId, fit.range.since, fit.range.until, link.campaignIds, options), fetchDayRows(token, link.accountId, prevSpan.since, prevSpan.until, link.campaignIds, options)]);
      reads.push({ link, now: cur, before: prev });
    } catch (err) {
      if (!(err instanceof MetaAdsError)) throw err;
      reads.push({ link, now: null, before: null });
    }
  });

  const total = links.length;
  const good = reads.filter((r): r is Read & { now: NonNullable<Read["now"]>; before: NonNullable<Read["before"]> } => r.now !== null && r.before !== null);
  if (total === 0) {
    const none: MonthLine = { now: null, before: null, why: "no_integration", covered: 0, total: 0 };
    return { month, before, spend: none, revenue: none };
  }

  const currencies = new Set(good.map((r) => r.link.currency ?? "?"));
  const mixed = currencies.size > 1 || currencies.has("?");
  const spend: MonthLine = mixed ? { now: null, before: null, why: "mixed_currency", covered: good.length, total } : line(good.map((r) => r.now.map((d) => ({ date: d.date, value: d.spend }))), good.map((r) => r.before.map((d) => ({ date: d.date, value: d.spend }))), good.length, total, good.length === 0 ? "failed" : undefined);

  const withPurchases = good.filter((r) => r.now.some((d) => d.purchaseValue !== null) || r.before.some((d) => d.purchaseValue !== null));
  const revMixed = new Set(withPurchases.map((r) => r.link.currency ?? "?")).size > 1 || withPurchases.some((r) => r.link.currency === null);
  const revenue: MonthLine =
    withPurchases.length === 0
      ? { now: null, before: null, why: good.length === 0 ? "failed" : "no_events", covered: 0, total }
      : revMixed
        ? { now: null, before: null, why: "mixed_currency", covered: withPurchases.length, total }
        : line(withPurchases.map((r) => r.now.map((d) => ({ date: d.date, value: d.purchaseValue ?? 0 }))), withPurchases.map((r) => r.before.map((d) => ({ date: d.date, value: d.purchaseValue ?? 0 }))), withPurchases.length, total);
  spend.currency = mixed ? null : good[0]?.link.currency;
  revenue.currency = revMixed ? null : withPurchases[0]?.link.currency;
  return { month, before, spend, revenue };
}

const cache = new TtlCache<OverviewPayload>(60_000, 50);

/**
 * The general dashboard from the real accounts: readings of every active client for the
 * period (and the one before it, when comparing) plus the month's daily series.
 * Cached for a minute per company and period; `refresh` skips the cache.
 */
export async function buildOverview(ctx: Ctx, input: { clientIds: readonly string[]; range: Span; before: Span | null; month: Span; monthBefore: Span; refresh?: boolean }): Promise<OverviewPayload> {
  const key = [ctx.accountId, input.range.since, input.range.until, input.before?.since ?? "-", input.before?.until ?? "-", input.month.since, input.month.until, [...input.clientIds].sort().join(",")].join("|");
  if (!input.refresh) {
    const hit = cache.get(key);
    if (hit) return hit;
  }
  const [links, settings] = await Promise.all([loadLinks(ctx), loadSettings(ctx)]);
  const linked = new Set(links.map((l) => l.clientId));

  const rows = await mapLimit(input.clientIds, 3, async (clientId): Promise<ClientOverviewRow> => {
    if (!linked.has(clientId)) {
      const read = readingsOf([]);
      return { clientId, segment: settings.get(clientId)?.segment ?? null, ...read };
    }
    const accounts = await collectAccountSnapshots(ctx, clientId, { since: input.range.since, until: input.range.until, compare: input.before, daily: false });
    return { clientId, segment: settings.get(clientId)?.segment ?? null, ...readingsOf(accounts) };
  });

  const month = await buildMonthSeries(ctx, links.filter((l) => input.clientIds.includes(l.clientId)), input.month, input.monthBefore, new Map([...settings].map(([id, v]) => [id, v.events])));
  const payload: OverviewPayload = { demo: false, range: input.range, before: input.before, clients: rows, month, generatedAt: new Date().toISOString() };
  cache.set(key, payload);
  return payload;
}
