import type { CampaignPeriodRow } from "./campaign-table";

export interface AdPeriodRow extends CampaignPeriodRow {
  campaignId: string;
  thumbnailUrl: string | null;
  previewUrl?: string | null;
  hasVideo?: boolean;
  reach: number | null;
  linkClicks: number | null;
}

/** Only Meta's image CDN, without OAuth credentials. Never expose a Graph bearer URL. */
export function safeAdThumbnail(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 4096) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return null;
    if (!["fbcdn.net", "fbsbx.com"].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) return null;
    if ([...url.searchParams.keys()].some((key) => ["access_token", "appsecret_proof", "client_secret", "authorization"].includes(key.toLowerCase()))) return null;
    return url.href;
  } catch { return null; }
}

export function needsAdTable(source: { blocks: readonly { network?: string; keys?: readonly string[]; widgets?: readonly { key?: string }[] }[] }): boolean {
  return source.blocks.some((b) => b.network === "meta_ads" && (b.keys?.includes("ads") || b.widgets?.some((w) => w.key === "ads")));
}

/** Only the official signed ad-preview frame. No arbitrary iframe HTML or OAuth URLs. */
export function safeAdVideoPreview(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 20000) return null;
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443") || !["www.facebook.com", "business.facebook.com"].includes(u.hostname) || u.pathname !== "/ads/api/preview_iframe.php" || !u.searchParams.get("d") || [...u.searchParams.keys()].some(k => !["d", "t"].includes(k))) return null;
    return u.href;
  } catch { return null; }
}
