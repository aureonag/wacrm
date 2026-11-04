// Thin client of the Nuvemshop REST API (server-only). Docs: tiendanube.github.io/api-documentation
//
//  - base URL is versioned and per store: /{version}/{store_id}/...
//  - auth is `Authorization: Bearer <token>` (the token does not expire)
//  - every request MUST carry a User-Agent naming the app, or it gets a 400
//  - the rate limit is a leaky bucket (40 requests, 2/s): a 429 says how long to wait
//
// Never log a token or the client secret.

export const NUVEMSHOP_API_BASE = "https://api.nuvemshop.com.br/2025-03";
export const NUVEMSHOP_AUTH_BASE = "https://www.nuvemshop.com.br";
export const NUVEMSHOP_TOKEN_URL = "https://www.tiendanube.com/apps/authorize/token";

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RATE_LIMIT_RETRIES = 3;

export function userAgent(): string {
  return process.env.NUVEMSHOP_USER_AGENT?.trim() || "Aureon Afiliados (https://aureonag.com)";
}

export interface NuvemshopConfig {
  appId: string;
  appSecret: string;
}

/** The app credentials (NUVEMSHOP_APP_ID / NUVEMSHOP_APP_SECRET), or null while they are not set. */
export function nuvemshopConfig(): NuvemshopConfig | null {
  const appId = process.env.NUVEMSHOP_APP_ID?.trim();
  const appSecret = process.env.NUVEMSHOP_APP_SECRET?.trim();
  return appId && appSecret ? { appId, appSecret } : null;
}

export class NuvemshopError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface StoreAuth {
  externalStoreId: string;
  token: string;
}

function describe(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const b = body as { description?: unknown; message?: unknown; error?: unknown };
    for (const v of [b.description, b.message, b.error]) {
      if (typeof v === "string" && v.trim()) return v.trim().slice(0, 300);
      if (v && typeof v === "object") {
        // 422 bodies look like { code: ["já existe"] } — keep the first message.
        const first = Object.values(v as Record<string, unknown>).flat().find((x) => typeof x === "string");
        if (typeof first === "string") return first.slice(0, 300);
      }
    }
    // 422 validation errors: { "code": ["..."] }
    const first = Object.values(body as Record<string, unknown>).flat().find((x) => typeof x === "string");
    if (typeof first === "string") return first.slice(0, 300);
  }
  return fallback;
}

export interface NuvemshopResponse<T> {
  data: T;
  /** URL of the next page (Link header), when there is one. */
  next: string | null;
}

function nextLink(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="?next"?/i);
    if (m) return m[1];
  }
  return null;
}

/**
 * One call to the store's API. `path` is relative to the store ("/orders/1"), or
 * a full URL taken from a `Link` header. Retries a 429 a few times, waiting as
 * long as the API asks (capped at 3s).
 */
export async function nuvemshopRequest<T>(
  store: StoreAuth,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<NuvemshopResponse<T>> {
  const url = path.startsWith("http") ? path : `${NUVEMSHOP_API_BASE}/${encodeURIComponent(store.externalStoreId)}${path}`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${store.token}`,
        "User-Agent": userAgent(),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (res.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
      const wait = Math.min(Number(res.headers.get("x-rate-limit-reset")) || 1000, 3000);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }

    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
    }
    if (!res.ok) throw new NuvemshopError(describe(parsed, `Nuvemshop respondeu ${res.status}`), res.status);
    return { data: parsed as T, next: nextLink(res.headers.get("link")) };
  }
}
