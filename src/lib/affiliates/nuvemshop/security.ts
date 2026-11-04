// Pure security helpers of the Nuvemshop integration: the HMAC the Nuvemshop
// sends with every webhook, and the signed `state` that ties an install started
// from the CRM to the client it was started for.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * True when `header` is the HMAC-SHA256 (hex) of the raw request body, keyed
 * with the app's client secret. The body MUST be the raw text, not re-serialized JSON.
 */
export function verifyWebhookSignature(rawBody: string, header: string | null | undefined, secret: string): boolean {
  if (!header || !secret) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(rawBody, "utf8").digest("hex"));
  const given = Buffer.from(header.trim().toLowerCase());
  return expected.length === given.length && timingSafeEqual(expected, given);
}

const STATE_TTL_MS = 15 * 60 * 1000;

export interface InstallState {
  /** aff_clients id the install is for. */
  c: string;
  /** Where to send the person afterwards (a path on this site). */
  r: string;
  /** Random per request. */
  n: string;
  /** Expiry, epoch ms. */
  e: number;
}

const sign = (payload: string, secret: string) => createHmac("sha256", secret).update(payload).digest("base64url");

export function signInstallState(input: { clientId: string; returnTo: string }, secret: string, now = Date.now()): string {
  const body: InstallState = { c: input.clientId, r: input.returnTo, n: randomBytes(8).toString("hex"), e: now + STATE_TTL_MS };
  const payload = Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

/** The state when the signature is valid and it has not expired, else null. */
export function verifyInstallState(token: string | null | undefined, secret: string, now = Date.now()): InstallState | null {
  if (!token || !secret) return null;
  const [payload, sig, extra] = token.split(".");
  if (!payload || !sig || extra !== undefined) return null;
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as InstallState;
    if (typeof s.c !== "string" || typeof s.r !== "string" || typeof s.e !== "number") return null;
    return s.e >= now ? s : null;
  } catch {
    return null;
  }
}

/** Only pages of the Afiliados workspace are valid return targets (blocks open redirects). */
export function safeReturnPath(raw: string | null | undefined, fallback: string): string {
  if (!raw || raw.startsWith("//") || raw.includes("\\") || /[\r\n]/.test(raw)) return fallback;
  if (!raw.startsWith("/operational/afiliados/") && !raw.startsWith("/portal/loja/")) return fallback;
  return raw;
}

/** Same path with `nuvemshop=<result>` set, replacing any previous value. */
export function withResult(path: string, result: string): string {
  const url = new URL(path, "http://placeholder.local");
  url.searchParams.set("nuvemshop", result);
  return `${url.pathname}${url.search}`;
}
