import { ATTRIBUTION_WINDOWS, campaignFilterParam, dataRows, isGraphNextUrl, listCampaigns, META_API_BASE, MetaAdsError, parseInsightsStrict, type ReadOptions } from "./meta-ads";
import type { CampaignPeriodRow } from "./campaign-table";

/** Two paginated reads, not one Insights request per campaign. Never writes to Meta. */
export async function fetchCampaignTable(
  token: string, accountId: string, since: string, until: string,
  campaignIds?: readonly string[] | null, options: ReadOptions = {},
): Promise<CampaignPeriodRow[]> {
  if (!/^act_\d+$/.test(accountId)) throw new MetaAdsError("Invalid ad account id", "invalid_filter");
  const filtering = campaignFilterParam(campaignIds); // Refuse invalid filters before making any request.
  const allowed = campaignIds ? new Set(campaignIds) : null;
  const first = new URL(`${META_API_BASE}/${accountId}/insights`);
  first.searchParams.set("fields", "campaign_id,campaign_name,spend,impressions,clicks,actions,action_values,attribution_setting");
  first.searchParams.set("level", "campaign");
  first.searchParams.set("time_range", JSON.stringify({ since, until }));
  first.searchParams.set("limit", "200");
  if (filtering) first.searchParams.set("filtering", filtering);
  if (options.attributionWindows?.length) {
    // The account reader validates the same allowed windows. Keep this reader strict on its own too.
    if (!options.attributionWindows.every((w) => (ATTRIBUTION_WINDOWS as readonly string[]).includes(w))) throw new MetaAdsError("Invalid attribution window", "invalid_filter");
    first.searchParams.set("action_attribution_windows", JSON.stringify(options.attributionWindows));
  }

  async function readPeriod() {
    const out = new Map<string, { name: string; insights: ReturnType<typeof parseInsightsStrict> }>();
    let next: string | undefined = first.toString();
    let pages = 0;
    while (next) {
      if (++pages > 20) throw new MetaAdsError("Too many campaign insight pages", "invalid_payload");
      const response = await fetch(next, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const body = await response.json().catch(() => null) as { error?: { code?: number }; paging?: { next?: string } } | null;
      if (!response.ok || body?.error) throw new MetaAdsError("Campaign results unavailable", body?.error?.code === 190 ? "token_invalid" : "request_failed");
      for (const row of dataRows(body)) {
        const id = row.campaign_id;
        if (typeof id !== "string" || !/^\d{1,30}$/.test(id) || out.has(id) || (allowed && !allowed.has(id))) throw new MetaAdsError("Unexpected campaign insight row", "invalid_payload");
        out.set(id, { name: typeof row.campaign_name === "string" ? row.campaign_name : id, insights: parseInsightsStrict(row, options) });
      }
      if (out.size > 500) throw new MetaAdsError("Campaign table exceeds 500 rows", "invalid_payload", "campaign_table_limit");
      next = body?.paging?.next;
      if (next && !isGraphNextUrl(next)) throw new MetaAdsError("Unexpected campaign insights next page", "invalid_payload");
    }
    return out;
  }

  const [listed, period] = await Promise.all([listCampaigns(token, accountId, true), readPeriod()]);
  const metadata = new Map(listed.filter((c) => !allowed || allowed.has(c.id)).map((c) => [c.id, c]));
  // Historical delivery can include campaigns no longer returned by the current campaign listing.
  const ids = new Set([...metadata.keys(), ...period.keys()]);
  if (ids.size > 500) throw new MetaAdsError("Campaign table exceeds 500 rows", "invalid_payload", "campaign_table_limit");
  return [...ids].map((id) => {
    const campaign = metadata.get(id);
    const data = period.get(id);
    const i = data?.insights ?? parseInsightsStrict(undefined, options); // Valid empty period, not a failed read.
    return {
      id, name: (campaign?.name ?? data?.name ?? id).slice(0, 400), status: campaign?.status ?? "",
      spend: i.spend, impressions: i.impressions, clicks: i.clicks,
      leads: i.leads ?? null, conversations: i.conversations ?? null, purchases: i.purchases ?? null,
    };
  });
}
