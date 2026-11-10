import { ATTRIBUTION_WINDOWS, campaignFilterParam, dataRows, isGraphNextUrl, META_API_BASE, MetaAdsError, parseInsightsStrict, type ReadOptions } from "./meta-ads";
import { safeAdThumbnail, type AdPeriodRow } from "./ad-table";

const validId = (value: unknown): value is string => typeof value === "string" && /^\d{1,30}$/.test(value);
const optionalNumber = (value: unknown): number | null => {
  if (value === undefined) return null;
  const n = typeof value === "string" && value.trim() ? Number(value) : typeof value === "number" ? value : NaN;
  if (!Number.isFinite(n) || n < 0) throw new MetaAdsError("Invalid ad metric", "invalid_payload");
  return n;
};

/** Period delivery only. Ads without delivery are not confused with unavailable data. */
export async function fetchAdTable(token: string, accountId: string, since: string, until: string, campaignIds?: readonly string[] | null, options: ReadOptions = {}): Promise<{ rows: AdPeriodRow[]; metadataUnavailable: boolean }> {
  if (!/^act_\d+$/.test(accountId)) throw new MetaAdsError("Invalid account", "invalid_filter");
  const filtering = campaignFilterParam(campaignIds);
  if (options.attributionWindows?.some((w) => !(ATTRIBUTION_WINDOWS as readonly string[]).includes(w))) throw new MetaAdsError("Invalid attribution", "invalid_filter");
  const allowed = campaignIds ? new Set(campaignIds) : null;
  const url = new URL(`${META_API_BASE}/${accountId}/insights`);
  url.searchParams.set("fields", "ad_id,ad_name,campaign_id,spend,impressions,clicks,reach,inline_link_clicks,actions,action_values,attribution_setting");
  url.searchParams.set("level", "ad");
  url.searchParams.set("time_range", JSON.stringify({ since, until }));
  url.searchParams.set("limit", "200");
  url.searchParams.set("filtering", JSON.stringify([...(filtering ? JSON.parse(filtering) : []), { field: "impressions", operator: "GREATER_THAN", value: 0 }]));
  if (options.attributionWindows?.length) url.searchParams.set("action_attribution_windows", JSON.stringify(options.attributionWindows));
  const headers = { Authorization: `Bearer ${token}` };
  const rows = new Map<string, AdPeriodRow>();
  const seen = new Set<string>();
  let next: string | undefined = url.href;
  let pages = 0;
  while (next) {
    if (++pages > 20) throw new MetaAdsError("Ad pagination limit", "invalid_payload");
    const res: Response = await fetch(next, { headers, cache: "no-store" });
    const body = await res.json().catch(() => null);
    if (!res.ok || body?.error) throw new MetaAdsError("Ad results unavailable", body?.error?.code === 190 ? "token_invalid" : "request_failed");
    for (const raw of dataRows(body)) {
      if (!validId(raw.ad_id) || !validId(raw.campaign_id) || seen.has(raw.ad_id) || (allowed && !allowed.has(raw.campaign_id))) throw new MetaAdsError("Unexpected ad insight", "invalid_payload");
      seen.add(raw.ad_id);
      // Meta can return identity-only historical ads even with an impressions filter.
      // Omit those non-delivery rows, without manufacturing zero metrics. A missing
      // impression count alongside any spend, click or action still fails strictly.
      if (raw.impressions === undefined && ["spend", "clicks", "reach", "inline_link_clicks"].every((k) => raw[k] === undefined || raw[k] === "0" || raw[k] === 0) && raw.actions === undefined && raw.action_values === undefined) continue;
      const i = parseInsightsStrict(raw, options);
      rows.set(raw.ad_id, { id: raw.ad_id, campaignId: raw.campaign_id, name: (typeof raw.ad_name === "string" ? raw.ad_name : raw.ad_id).slice(0, 400), status: "", thumbnailUrl: null, spend: i.spend, impressions: i.impressions, clicks: i.clicks, reach: optionalNumber(raw.reach), linkClicks: optionalNumber(raw.inline_link_clicks), leads: i.leads ?? null, conversations: i.conversations ?? null, purchases: i.purchases ?? null });
    }
    if (rows.size > 500) throw new MetaAdsError("Ad table exceeds 500 rows", "invalid_payload", "ad_table_limit");
    next = body?.paging?.next;
    if (next && !isGraphNextUrl(next)) throw new MetaAdsError("Unexpected ad insights next page", "invalid_payload");
  }
  // Fetch only delivered ad IDs through the account edge, in bounded groups, never N+1.
  // The root Graph `ids` query is no longer supported in the version Meta serves.
  let metadataUnavailable = false;
  const ids = [...rows.keys()];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const requested = new Set(ids.slice(offset, offset + 100));
    const meta = new URL(`${META_API_BASE}/${accountId}/ads`);
    meta.searchParams.set("fields", "id,name,account_id,effective_status,campaign_id,creative{id,thumbnail_url,image_url}");
    meta.searchParams.set("filtering", JSON.stringify([{ field: "id", operator: "IN", value: [...requested] }]));
    meta.searchParams.set("limit", "200");
    let metaNext: string | undefined = meta.href;
    let metaPages = 0;
    const found = new Set<string>();
    const originalNames = new Map([...requested].map((id) => [id, rows.get(id)!.name]));
    try {
      while (metaNext) {
        if (++metaPages > 20) throw new Error("Metadata pagination limit");
        const res: Response = await fetch(metaNext, { headers, cache: "no-store" });
        const body = await res.json().catch(() => null);
        if (!res.ok || body?.error) throw new Error("Ad metadata unavailable");
        for (const raw of dataRows(body)) {
          if (!validId(raw.id) || !requested.has(raw.id) || found.has(raw.id) || raw.account_id !== accountId.slice(4) || raw.campaign_id !== rows.get(raw.id)?.campaignId) throw new Error("Unverified ad metadata");
          found.add(raw.id);
          const row = rows.get(raw.id)!;
          row.name = (typeof raw.name === "string" ? raw.name : row.name).slice(0, 400);
          row.status = typeof raw.effective_status === "string" ? raw.effective_status.slice(0, 60) : "";
          const creative = raw.creative as Record<string, unknown> | undefined;
          row.thumbnailUrl = safeAdThumbnail(creative?.thumbnail_url);
          row.previewUrl = safeAdThumbnail(creative?.image_url);
        }
        metaNext = body?.paging?.next;
        if (metaNext && !isGraphNextUrl(metaNext)) throw new Error("Unexpected metadata next page");
      }
      if (found.size !== requested.size) metadataUnavailable = true;
    } catch {
      metadataUnavailable = true;
      // Refuse partial/unverified identities for this group; keep independently read metrics.
      for (const id of requested) { const row = rows.get(id)!; row.name = originalNames.get(id)!; row.status = ""; row.thumbnailUrl = null; row.previewUrl = null; }
    }
  }
  return { rows: [...rows.values()], metadataUnavailable };
}

