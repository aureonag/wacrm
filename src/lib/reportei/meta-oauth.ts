// "Entrar com Facebook" for Operacional → Reportei, like Reportei's own
// "Integrar": the person signs in, we receive a code, trade it for a long-lived
// token (~60 days) and keep it encrypted (meta_connections, migration 159).
//
// Needs a Meta app (type Business) with Facebook Login and the `ads_read`
// permission, configured through META_ADS_APP_ID / META_ADS_APP_SECRET. While
// the app is in Development mode, people with a role on the app can sign in
// without App Review, which is the case for the Aureon team.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { META_API_BASE, META_API_VERSION, metaErrorKind, MetaAdsError } from "./meta-ads";

export const META_SCOPES = ["ads_read"] as const;
const STATE_TTL_MS = 10 * 60 * 1000;
const RETURN_PREFIX = "/operational/reportei/";

export function isMetaLoginConfigured(): boolean {
  return Boolean(process.env.META_ADS_APP_ID && process.env.META_ADS_APP_SECRET);
}

/** Only same-site paths inside Reportei are valid return targets (blocks open redirects). */
export function safeReturnTo(raw: string | null | undefined): string {
  const fallback = "/operational/reportei/clientes";
  if (!raw || !raw.startsWith(RETURN_PREFIX) || raw.startsWith("//") || raw.includes("\\") || /[\r\n]/.test(raw)) return fallback;
  return raw;
}

/** Same path with `meta=<result>` set, replacing any previous value. */
export function withMetaResult(returnTo: string, result: string): string {
  const url = new URL(returnTo, "http://placeholder.local");
  url.searchParams.set("meta", result);
  return `${url.pathname}${url.search}`;
}

export interface OAuthState {
  /** wacrm user who started the sign-in. */
  u: string;
  /** wacrm account. */
  a: string;
  /** Where to send the person afterwards. */
  r: string;
  /** Random per request. */
  n: string;
  /** Expiry, epoch ms. */
  e: number;
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function signState(state: Omit<OAuthState, "n" | "e">, secret: string, now = Date.now()): string {
  const payload = b64(JSON.stringify({ ...state, n: randomBytes(8).toString("hex"), e: now + STATE_TTL_MS } satisfies OAuthState));
  return `${payload}.${sign(payload, secret)}`;
}

/** Returns the state when the signature is valid and it has not expired, else null. */
export function verifyState(token: string | null | undefined, secret: string, now = Date.now()): OAuthState | null {
  if (!token) return null;
  const [payload, sig, extra] = token.split(".");
  if (!payload || !sig || extra !== undefined) return null;
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OAuthState;
    if (typeof s.u !== "string" || typeof s.a !== "string" || typeof s.r !== "string" || typeof s.e !== "number") return null;
    return s.e >= now ? s : null;
  } catch {
    return null;
  }
}

/**
 * Meta's sign-in URL. An app with "Facebook Login for Business" does not take
 * `scope`: its permissions live in a configuration (META_ADS_CONFIG_ID), passed
 * as `config_id`. Without a configuration id we fall back to the classic `scope`.
 */
export function buildAuthUrl({
  appId,
  redirectUri,
  state,
  configId,
}: {
  appId: string;
  redirectUri: string;
  state: string;
  configId?: string;
}): string {
  const url = new URL(`https://www.facebook.com/${META_API_VERSION}/dialog/oauth`);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  if (configId) {
    url.searchParams.set("config_id", configId);
    url.searchParams.set("override_default_response_type", "true");
  } else {
    url.searchParams.set("scope", META_SCOPES.join(","));
  }
  return url.toString();
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: { code?: number; message?: string };
}

async function getJson<T>(url: URL): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  return (await res.json().catch(() => ({}))) as T;
}

/** Trades the sign-in code for a long-lived token. Never logs the secret or the tokens. */
export async function exchangeCode({ code, redirectUri }: { code: string; redirectUri: string }): Promise<{ token: string; expiresAt: Date | null }> {
  const appId = process.env.META_ADS_APP_ID;
  const appSecret = process.env.META_ADS_APP_SECRET;
  if (!appId || !appSecret) throw new MetaAdsError("Meta login is not configured", "not_configured");

  const shortUrl = new URL(`${META_API_BASE}/oauth/access_token`);
  shortUrl.searchParams.set("client_id", appId);
  shortUrl.searchParams.set("client_secret", appSecret);
  shortUrl.searchParams.set("redirect_uri", redirectUri);
  shortUrl.searchParams.set("code", code);
  const short = await getJson<TokenResponse>(shortUrl);
  if (!short.access_token) throw new MetaAdsError(`Meta code exchange failed (${short.error?.code ?? "?"})`, metaErrorKind(short.error?.code));

  const longUrl = new URL(`${META_API_BASE}/oauth/access_token`);
  longUrl.searchParams.set("grant_type", "fb_exchange_token");
  longUrl.searchParams.set("client_id", appId);
  longUrl.searchParams.set("client_secret", appSecret);
  longUrl.searchParams.set("fb_exchange_token", short.access_token);
  const long = await getJson<TokenResponse>(longUrl);
  if (!long.access_token) throw new MetaAdsError(`Meta long-lived exchange failed (${long.error?.code ?? "?"})`, metaErrorKind(long.error?.code));

  return {
    token: long.access_token,
    expiresAt: typeof long.expires_in === "number" ? new Date(Date.now() + long.expires_in * 1000) : null,
  };
}

/** Who the token belongs to, for showing "Conectado como …". */
export async function fetchMetaProfile(token: string): Promise<{ id: string; name: string | null }> {
  const url = new URL(`${META_API_BASE}/me`);
  url.searchParams.set("fields", "id,name");
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as { id?: string; name?: string; error?: { code?: number } };
  if (!res.ok || !body.id) throw new MetaAdsError(`Meta profile failed (${body.error?.code ?? res.status})`, metaErrorKind(body.error?.code));
  return { id: body.id, name: body.name ?? null };
}
