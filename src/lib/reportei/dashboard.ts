// Dashboards: the live numbers of every client in one table. Pure helpers (sum
// the accounts of a client, compare with the previous period, a small cache and
// a bounded parallel map); the Meta reads themselves are in report-data.ts.

import type { AccountSnapshot } from "@/lib/reportei/report";
import { variation } from "@/lib/reportei/report";

export const SORT_KEYS = ["name", "spend", "clicks", "ctr", "cpc"] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export interface Totals {
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
}

export interface ClientSummary {
  clientId: string;
  name: string;
  code: string | null;
  /** Ad accounts linked / read without error. */
  accounts: number;
  readable: number;
  /** Null when no account could be read. */
  totals: Totals | null;
  previous: Totals | null;
  /** Spend and CPC are money: with accounts in different currencies they are not summed. */
  currency: string | null;
  mixedCurrency: boolean;
  /** First reason an account could not be read, when none was. */
  error: string | null;
}

const rate = (num: number, den: number, scale = 1) => (den > 0 ? (num / den) * scale : 0);

function sum(list: { spend: number; impressions: number; clicks: number }[], mixed: boolean): Totals {
  const spend = list.reduce((s, x) => s + x.spend, 0);
  const impressions = list.reduce((s, x) => s + x.impressions, 0);
  const clicks = list.reduce((s, x) => s + x.clicks, 0);
  return { spend: mixed ? 0 : spend, impressions, clicks, ctr: rate(clicks, impressions, 100), cpc: mixed ? 0 : rate(spend, clicks) };
}

/** One client's accounts as a single row. `compared` tells whether the previous period was asked for. */
export function summarizeClient(client: { clientId: string; name: string; code: string | null }, accounts: AccountSnapshot[]): ClientSummary {
  const ok = accounts.filter((a) => a.insights);
  const currencies = new Set(ok.map((a) => a.currency ?? ""));
  const mixedCurrency = currencies.size > 1;
  const withPrevious = ok.filter((a) => a.previous);
  return {
    ...client,
    accounts: accounts.length,
    readable: ok.length,
    totals: ok.length > 0 ? sum(ok.map((a) => a.insights!), mixedCurrency) : null,
    // The comparison is only fair when every readable account has its previous numbers.
    previous: ok.length > 0 && withPrevious.length === ok.length ? sum(withPrevious.map((a) => a.previous!), mixedCurrency) : null,
    currency: mixedCurrency ? null : (ok[0]?.currency ?? null),
    mixedCurrency,
    error: ok.length === 0 ? (accounts.find((a) => a.error)?.error ?? null) : null,
  };
}

/** Percent change of one metric against the previous period, or null without a base. */
export function change(summary: Pick<ClientSummary, "totals" | "previous">, key: Exclude<SortKey, "name">): number | null {
  if (!summary.totals || !summary.previous) return null;
  return variation(summary.totals[key], summary.previous[key]);
}

/** Sorted copy: names A→Z, numbers high→low; clients without data go last. */
export function sortSummaries(list: readonly ClientSummary[], key: SortKey): ClientSummary[] {
  return [...list].sort((a, b) => {
    if (key === "name") return a.name.localeCompare(b.name, "pt-BR");
    const av = a.totals?.[key];
    const bv = b.totals?.[key];
    if (av === undefined && bv === undefined) return a.name.localeCompare(b.name, "pt-BR");
    if (av === undefined) return 1;
    if (bv === undefined) return -1;
    return bv - av || a.name.localeCompare(b.name, "pt-BR");
  });
}

/** Runs `fn` over `items` with at most `limit` in flight; results keep the order of `items`. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** A tiny in-memory cache with a time to live; `now` is injectable for tests. */
export class TtlCache<V> {
  private readonly entries = new Map<string, { value: V; at: number }>();
  constructor(
    private readonly ttlMs: number,
    private readonly max = 500,
  ) {}

  get(key: string, now = Date.now()): V | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (now - hit.at > this.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: V, now = Date.now()): void {
    if (this.entries.size >= this.max) this.entries.delete(this.entries.keys().next().value as string);
    this.entries.set(key, { value, at: now });
  }
}

export interface OverallTotals {
  totals: Totals | null;
  /** Clients that had data and were added up. */
  clients: number;
  /** Money is only added up when every added client reports in the same currency. */
  currency: string | null;
  mixedCurrency: boolean;
}

/** The sum of the clients on screen (the "Total" row): clicks and impressions always, money only in a single currency. */
export function overallTotals(rows: readonly ClientSummary[]): OverallTotals {
  const withData = rows.filter((r) => r.totals);
  if (withData.length === 0) return { totals: null, clients: 0, currency: null, mixedCurrency: false };
  const currencies = new Set(withData.map((r) => (r.mixedCurrency ? "*mixed*" : (r.currency ?? ""))));
  const mixedCurrency = currencies.size > 1 || currencies.has("*mixed*");
  return {
    totals: sum(
      withData.map((r) => r.totals!),
      mixedCurrency,
    ),
    clients: withData.length,
    currency: mixedCurrency ? null : (withData[0].currency ?? null),
    mixedCurrency,
  };
}
