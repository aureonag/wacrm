// ============================================================
// Prospecting: website analysis (public digital-presence signals).
//
// The candidate's website is agent/enrichment-supplied — effectively
// attacker-adjacent, exactly like a webhook URL — so this reuses the
// SAME SSRF guard the webhook delivery path already uses
// (`isDeliverableUrl`, `src/lib/webhooks/ssrf.ts`) rather than
// reimplementing it. Every signal here is a heuristic derived from
// public HTML — never presented as a confirmed fact (the ICP scorer
// treats `null` and `false` differently on purpose).
// ============================================================

import { isDeliverableUrl } from "@/lib/webhooks/ssrf";

const REQUEST_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;
const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2MB — enough for real page HTML, bounded against abuse.
const USER_AGENT = "AureonProspectingBot/1.0 (+https://aureonag.com.br)";

export interface WebsiteSignals {
  finalUrl: string;
  hasHttps: boolean;
  title: string | null;
  description: string | null;
  phone: string | null;
  email: string | null;
  socialLinks: string[];
  /** Heuristic: a viewport meta tag suggests a responsive layout. `null` when unknown (fetch failed). */
  looksResponsive: boolean | null;
  /** Heuristic: presence of common contact/CTA language (WhatsApp, "fale conosco", "orçamento", ...). */
  hasCallToActionSignal: boolean;
}

function isDeliverableHttpUrl(rawUrl: string): { ok: boolean; url: URL | null } {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, url: null };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, url: null };
  return { ok: true, url };
}

async function readBodyCapped(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf-8");
}

async function fetchHtmlFollowingRedirects(startUrl: string): Promise<{ html: string; finalUrl: string } | null> {
  let currentUrl = startUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const { ok, url } = isDeliverableHttpUrl(currentUrl);
    if (!ok || !url) return null;
    // Re-validated on every hop — a public URL must not be able to
    // 3xx-bounce into a private/internal address (redirect: 'manual'
    // below is what makes that re-check possible).
    if (!(await isDeliverableUrl(currentUrl))) return null;

    let res: Response;
    try {
      res = await fetch(currentUrl, {
        redirect: "manual",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { "User-Agent": USER_AGENT },
      });
    } catch {
      return null;
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return null;
      try {
        currentUrl = new URL(location, currentUrl).toString();
      } catch {
        return null;
      }
      continue;
    }

    if (!res.ok) return null;
    const html = await readBodyCapped(res);
    return { html, finalUrl: currentUrl };
  }
  return null; // too many redirects
}

function extractTag(html: string, pattern: RegExp): string | null {
  const match = html.match(pattern);
  return match?.[1]?.trim() || null;
}

function extractSocialLinks(html: string): string[] {
  const hrefs = [...html.matchAll(/href=["']([^"']+)["']/gi)].map((m) => m[1]);
  const social = hrefs.filter((h) => /instagram\.com|facebook\.com|wa\.me|api\.whatsapp\.com/i.test(h));
  return [...new Set(social)];
}

function extractPhone(html: string): string | null {
  // Loose BR-leaning phone pattern — a heuristic signal, not validated
  // the way `normalizePhone` validates a real contact-record phone.
  const match = html.match(/(?:\+?55\s*)?\(?\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}/);
  return match?.[0]?.trim() || null;
}

function extractEmail(html: string): string | null {
  const match = html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return match?.[0]?.toLowerCase() || null;
}

const CTA_KEYWORDS = /fale conosco|entre em contato|solicitar or[çc]amento|pe[çc]a um or[çc]amento|whatsapp|compre agora|agende|contact us|get a quote/i;

export async function analyzeWebsite(rawUrl: string): Promise<WebsiteSignals | null> {
  const fetched = await fetchHtmlFollowingRedirects(rawUrl);
  if (!fetched) return null;

  const { html, finalUrl } = fetched;
  return {
    finalUrl,
    hasHttps: finalUrl.startsWith("https:"),
    title: extractTag(html, /<title[^>]*>([^<]*)<\/title>/i),
    description: extractTag(
      html,
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i,
    ),
    phone: extractPhone(html),
    email: extractEmail(html),
    socialLinks: extractSocialLinks(html),
    looksResponsive: /<meta[^>]+name=["']viewport["']/i.test(html),
    hasCallToActionSignal: CTA_KEYWORDS.test(html),
  };
}
