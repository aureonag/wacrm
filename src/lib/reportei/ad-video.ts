import { campaignFilterParam, dataRows, META_API_BASE, MetaAdsError } from "./meta-ads";

import { safeAdVideoPreview } from "./ad-table";

export async function fetchAdVideoPreview(token: string, accountId: string, adId: string, campaignIds?: readonly string[] | null): Promise<string> {
  if (!/^act_\d+$/.test(accountId) || !/^\d{1,30}$/.test(adId)) throw new MetaAdsError("Invalid ad", "invalid_filter");
  campaignFilterParam(campaignIds); // Fail closed on malformed saved restrictions.
  const read = async (url: URL) => {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(20000) });
    const body = await r.json().catch(() => null);
    if (!r.ok || body?.error) throw new MetaAdsError("Video preview unavailable", "request_failed");
    return body;
  };
  const url = new URL(`${META_API_BASE}/${accountId}/ads`);
  url.searchParams.set("fields", "id,account_id,campaign_id,creative{video_id}");
  url.searchParams.set("filtering", JSON.stringify([{ field: "id", operator: "IN", value: [adId] }]));
  url.searchParams.set("limit", "1");
  const ads = dataRows(await read(url));
  const ad = ads[0];
  const creative = ad?.creative as Record<string, unknown> | undefined;
  if (ads.length !== 1 || ad.id !== adId || ad.account_id !== accountId.slice(4) || typeof ad.campaign_id !== "string" || (campaignIds && !campaignIds.includes(ad.campaign_id)) || typeof creative?.video_id !== "string" || !/^\d{1,30}$/.test(creative.video_id)) throw new MetaAdsError("Video not available in this selection", "permission");
  const preview = new URL(`${META_API_BASE}/${adId}/previews`);
  preview.searchParams.set("ad_format", "DESKTOP_FEED_STANDARD");
  const data = dataRows(await read(preview));
  const html = data[0]?.body;
  const src = typeof html === "string" ? html.match(/<iframe\b[^>]*\bsrc=["']([^"']+)["']/i)?.[1]?.replaceAll("&amp;", "&") : null;
  const safe = safeAdVideoPreview(src);
  if (!safe) throw new MetaAdsError("Unverified preview frame", "invalid_payload");
  return safe;
}
