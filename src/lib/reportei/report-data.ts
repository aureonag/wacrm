// Reads the numbers of every Meta ad account linked to a client for one range,
// through the company connection each account was linked under. Shared by the
// live view (/insights) and by saved reports. Never returns a token.

import type { AccountContext } from "@/lib/auth/account";
import { fetchAccountInsights, fetchDailyInsights, MetaAdsError } from "@/lib/reportei/meta-ads";
import { getCompanyConnection } from "@/lib/reportei/meta-connection";
import { fillDays, type AccountSnapshot } from "@/lib/reportei/report";

type Connection = Awaited<ReturnType<typeof getCompanyConnection>>;

/** One entry per linked account: its insights, or the reason they could not be read. Throws only on a database failure. */
export async function collectAccountSnapshots(
  ctx: Pick<AccountContext, "supabase" | "accountId">,
  clientId: string,
  ranges: { since: string; until: string; compare?: { since: string; until: string } | null; daily?: boolean },
): Promise<AccountSnapshot[]> {
  const rows = await ctx.supabase
    .from("ad_integrations")
    .select("external_account_id, external_account_name, currency, connection_id")
    .eq("client_id", clientId)
    .eq("account_id", ctx.accountId)
    .eq("provider", "meta_ads")
    .order("created_at", { ascending: true });
  if (rows.error) throw new Error(`Failed to load integrations: ${rows.error.message}`);

  const connections = new Map<string, Connection>();
  const accounts: AccountSnapshot[] = [];
  for (const r of rows.data ?? []) {
    const base = {
      id: r.external_account_id as string,
      name: (r.external_account_name as string | null) ?? (r.external_account_id as string),
      currency: (r.currency as string | null) ?? null,
    };
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
    try {
      const insights = await fetchAccountInsights(connection.token, base.id, ranges.since, ranges.until);
      const entry: AccountSnapshot = { ...base, insights };
      if (ranges.compare) {
        try {
          entry.previous = await fetchAccountInsights(connection.token, base.id, ranges.compare.since, ranges.compare.until);
        } catch (err) {
          // The main numbers are still good; only the comparison is missing.
          if (!(err instanceof MetaAdsError)) throw err;
        }
      }
      if (ranges.daily) {
        // Charts are a bonus: a failed daily read never costs the report its totals.
        try {
          entry.daily = fillDays(await fetchDailyInsights(connection.token, base.id, ranges.since, ranges.until), ranges.since, ranges.until);
          if (ranges.compare) {
            entry.dailyPrevious = fillDays(await fetchDailyInsights(connection.token, base.id, ranges.compare.since, ranges.compare.until), ranges.compare.since, ranges.compare.until);
          }
        } catch (err) {
          if (!(err instanceof MetaAdsError)) throw err;
          delete entry.dailyPrevious;
        }
      }
      accounts.push(entry);
    } catch (err) {
      if (!(err instanceof MetaAdsError)) throw err;
      accounts.push({ ...base, error: err.code === "permission" || err.code === "token_invalid" ? err.code : "request_failed", detail: err.detail });
    }
  }
  return accounts;
}
