// ============================================================
// Prospecting: Instagram handle discovery.
//
// No dedicated Instagram API/provider is wired in this version — per
// the client spec, Instagram is complementary and must never depend
// on fragile scraping. The only supported source today is the
// candidate's own website (a link the site owner chose to publish).
// Followers/engagement are never invented — always null until a real
// provider is plugged in (`isInstagramProviderConfigured` exists so
// that day doesn't require touching every call site).
// ============================================================

import { normalizeInstagramHandle } from "./dedupe";

export interface InstagramLookupResult {
  handle: string | null;
  profileUrl: string | null;
  source: "website" | null;
  /** Always null in this version — never fabricated. */
  followers: number | null;
  /** Always null in this version — never fabricated. */
  engagement: number | null;
}

const EMPTY_RESULT: InstagramLookupResult = {
  handle: null,
  profileUrl: null,
  source: null,
  followers: null,
  engagement: null,
};

export function isInstagramProviderConfigured(): boolean {
  return false;
}

/** Best-effort: picks the first Instagram link out of a website's discovered social links. */
export function findInstagramFromWebsiteLinks(socialLinks: string[]): InstagramLookupResult {
  const igLink = socialLinks.find((link) => /instagram\.com\//i.test(link));
  if (!igLink) return EMPTY_RESULT;

  const handle = normalizeInstagramHandle(igLink);
  if (!handle) return EMPTY_RESULT;

  return { handle, profileUrl: `https://instagram.com/${handle}`, source: "website", followers: null, engagement: null };
}
