// Reads the numbers of every Meta ad account linked to a client for one range,
// through the company connection each account was linked under. Shared by the
// live view (/insights) and by saved reports. Never returns a token.
//
// What each read uses besides the dates: the campaigns of the link (or a choice made for
// this read), the events the client counts leads and purchases with, the attribution windows
// of the link, and the account's own time zone (the range is never past the account's today;
// the zone and the range really used are kept in the snapshot).

import type { AccountContext } from "@/lib/auth/account";
import { rangeForAccount, accountToday } from "@/lib/reportei/account-time";
import { fetchAccountInsights, fetchDailyInsights, MetaAdsError, type EventConfig } from "@/lib/reportei/meta-ads";
import { getCompanyConnection } from "@/lib/reportei/meta-connection";
import { fillDays, previousRange, type AccountSnapshot } from "@/lib/reportei/report";
import { fetchCampaignTable } from "@/lib/reportei/campaign-data";
import { fetchAdTable } from "./ad-data";

type Connection = Awaited<ReturnType<typeof getCompanyConnection>>;
type Ctx = Pick<AccountContext, "supabase" | "accountId">;

/** The events a client pins for leads and purchases (null = the canonical ones). Before migration 180 there is none. */
export async function loadClientEvents(ctx: Ctx, clientId: string): Promise<EventConfig> {
  const { data, error } = await ctx.supabase.from("reportei_client_settings").select("lead_event, purchase_event").eq("client_id", clientId).eq("account_id", ctx.accountId).maybeSingle();
  if (error || !data) return {};
  return { lead: (data.lead_event as string | null) ?? null, purchase: (data.purchase_event as string | null) ?? null };
}

/** The attribution windows saved on a link: null = whatever Meta applies; anything unknown is refused later by the read, never ignored. */
function windowsOf(v: unknown): string[] | null {
  return Array.isArray(v) && v.length > 0 ? (v as string[]) : null;
}

const LINK_COLUMNS = "external_account_id, external_account_name, currency, timezone, connection_id, campaign_ids";

/** The links of a client. `attribution_windows` exists only after migration 181: without it the read still works, with Meta's default attribution. */
async function loadLinks(ctx: Ctx, clientId: string) {
  const query = (columns: string) =>
    ctx.supabase.from("ad_integrations").select(columns).eq("client_id", clientId).eq("account_id", ctx.accountId).eq("provider", "meta_ads").order("created_at", { ascending: true });
  const withWindows = await query(`${LINK_COLUMNS}, attribution_windows`);
  if (!withWindows.error) return withWindows.data as unknown as Record<string, unknown>[];
  if (withWindows.error.code !== "42703") throw new Error(`Failed to load integrations: ${withWindows.error.message}`);
  const plain = await query(LINK_COLUMNS);
  if (plain.error) throw new Error(`Failed to load integrations: ${plain.error.message}`);
  return plain.data as unknown as Record<string, unknown>[];
}

/** One entry per linked account: its insights, or the reason they could not be read. Throws only on a database failure. */
export async function collectAccountSnapshots(
  ctx: Ctx,
  clientId: string,
  ranges: {
    since: string;
    until: string;
    compare?: { since: string; until: string } | null;
    daily?: boolean;
    campaignTable?: boolean;
    adTable?: boolean;
    /** Campaigns chosen for this read only, by ad account id (null = the whole account); overrides what is saved on the link. */
    campaigns?: Record<string, string[] | null>;
    /** For tests: the moment "now" is taken at. */
    now?: Date;
  },
): Promise<AccountSnapshot[]> {
  const rows = await loadLinks(ctx, clientId);
  const events = await loadClientEvents(ctx, clientId);

  const connections = new Map<string, Connection>();
  const accounts: AccountSnapshot[] = [];
  for (const r of rows) {
    const timezone = (r.timezone as string | null) ?? null;
    const base = {
      clientId,
      id: r.external_account_id as string,
      name: (r.external_account_name as string | null) ?? (r.external_account_id as string),
      currency: (r.currency as string | null) ?? null,
      timezone,
    };
    // NULL (or empty) campaigns = the whole account; a choice made for this read wins over the saved one.
    const saved = ((r.campaign_ids as string[] | null) ?? []).length > 0 ? (r.campaign_ids as string[]) : null;
    const campaignIds = ranges.campaigns && base.id in ranges.campaigns ? ranges.campaigns[base.id] : saved;
    const options = { events, attributionWindows: windowsOf(r.attribution_windows) };

    const connectionId = r.connection_id as string | null;
    if (!connectionId) {
      accounts.push({ ...base, error: "connection_unavailable" });
      continue;
    }
    if (!connections.has(connectionId)) connections.set(connectionId, await getCompanyConnection(ctx.accountId, connectionId));
    const connection = connections.get(connectionId);
    if (!connection) {
      accounts.push({ ...base, error: "connection_unavailable" });
      continue;
    }

    // The account's own today: days that have not started there are not asked for.
    const fit = rangeForAccount({ since: ranges.since, until: ranges.until }, accountToday(timezone, ranges.now));
    if (fit.empty) {
      accounts.push({ ...base, error: "request_failed", detail: "period_after_account_today" });
      continue;
    }
    const range = fit.range;
    const compare = ranges.compare ? (fit.clamped ? previousRange(range.since, range.until) : ranges.compare) : null;

    try {
      const insights = await fetchAccountInsights(connection.token, base.id, range.since, range.until, campaignIds, options);
      const entry: AccountSnapshot = { ...base, ...(campaignIds ? { campaigns: campaignIds.length } : {}), range, ...(compare ? { compareRange: compare } : {}), insights };
      if (ranges.campaignTable) {
        try {
          entry.campaignTable = { rows: await fetchCampaignTable(connection.token, base.id, range.since, range.until, campaignIds, options), readAt: (ranges.now ?? new Date()).toISOString() };
        } catch (error) {
          // A failed breakdown never removes valid account totals, and never becomes an empty table.
          entry.campaignTableError = error instanceof MetaAdsError && error.detail === "campaign_table_limit"
            ? "A seleção ultrapassa 500 campanhas. Selecione menos campanhas na integração para exibir a tabela completa."
            : "Não foi possível ler as campanhas e seus resultados na Meta. Atualize para tentar novamente.";
        }
      }
      if (ranges.adTable) {
        try {
          entry.adTable = { ...await fetchAdTable(connection.token, base.id, range.since, range.until, campaignIds, options), readAt: (ranges.now ?? new Date()).toISOString() };
        } catch (error) {
          entry.adTableError = error instanceof MetaAdsError && error.detail === "ad_table_limit"
            ? "A seleção ultrapassa 500 anúncios. Selecione menos campanhas na integração para exibir a tabela completa."
            : "Não foi possível ler os anúncios e seus resultados na Meta. Atualize para tentar novamente.";
        }
      }
      if (compare) {
        try {
          entry.previous = await fetchAccountInsights(connection.token, base.id, compare.since, compare.until, campaignIds, options);
        } catch (err) {
          // The main numbers are still good; only the comparison is missing.
          if (!(err instanceof MetaAdsError)) throw err;
        }
      }
      if (ranges.daily) {
        // Charts are a bonus: a failed daily read never costs the report its totals.
        try {
          entry.daily = fillDays(await fetchDailyInsights(connection.token, base.id, range.since, range.until, campaignIds), range.since, range.until);
          if (compare) {
            entry.dailyPrevious = fillDays(await fetchDailyInsights(connection.token, base.id, compare.since, compare.until, campaignIds), compare.since, compare.until);
          }
        } catch (err) {
          if (!(err instanceof MetaAdsError)) throw err;
          delete entry.dailyPrevious;
        }
      }
      accounts.push(entry);
    } catch (err) {
      if (!(err instanceof MetaAdsError)) throw err;
      accounts.push({ ...base, error: err.code === "not_configured" || err.code === "invalid_payload" || err.code === "invalid_filter" ? "request_failed" : err.code, detail: err.detail });
    }
  }
  return accounts;
}
