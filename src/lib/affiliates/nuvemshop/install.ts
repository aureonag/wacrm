// Installing the app on a store (server-only): trade the OAuth code for the
// store's token, read the store's name, save it, and subscribe to the events we
// need. See https://tiendanube.github.io/api-documentation/authentication

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/contracts/admin-client";
import {
  NUVEMSHOP_AUTH_BASE,
  NUVEMSHOP_TOKEN_URL,
  nuvemshopConfig,
  nuvemshopRequest,
  NuvemshopError,
  userAgent,
  type StoreAuth,
} from "./api";
import { getIntegrationByStoreId, getIntegrationForClient, patchIntegration, saveIntegration, type Integration } from "./store";

/** Events the CRM listens to, delivered to /api/integrations/nuvemshop/webhooks/events. */
export const WEBHOOK_EVENTS = ["order/created", "order/paid", "order/cancelled", "order/voided", "order/updated", "app/uninstalled"] as const;

export function authorizeUrl(appId: string, state: string): string {
  const url = new URL(`${NUVEMSHOP_AUTH_BASE}/apps/${encodeURIComponent(appId)}/authorize`);
  url.searchParams.set("state", state);
  return url.toString();
}

export function webhookUrl(origin: string): string {
  return `${origin}/api/integrations/nuvemshop/webhooks/events`;
}

interface TokenResponse {
  access_token?: string;
  scope?: string;
  user_id?: number | string;
  store_id?: number | string;
  error?: string;
  error_description?: string;
}

/** The code is valid for 5 minutes and works once. Never logs the secret or the token. */
export async function exchangeCode(code: string): Promise<{ token: string; storeId: string; scopes: string | null }> {
  const cfg = nuvemshopConfig();
  if (!cfg) throw new NuvemshopError("Nuvemshop app is not configured", 503);
  const res = await fetch(NUVEMSHOP_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": userAgent() },
    body: JSON.stringify({ client_id: cfg.appId, client_secret: cfg.appSecret, grant_type: "authorization_code", code }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as TokenResponse;
  const storeId = body.user_id ?? body.store_id;
  if (!res.ok || !body.access_token || storeId === undefined) {
    throw new NuvemshopError(`Nuvemshop code exchange failed (${body.error ?? res.status})`, res.status);
  }
  return { token: body.access_token, storeId: String(storeId), scopes: body.scope ?? null };
}

interface StoreInfo {
  name?: string | Record<string, string>;
  url_with_protocol?: string;
  main_domain?: string;
  original_domain?: string;
}

/** Store name (it comes per language: {"pt": "..."}) and address, for showing "Conectada: …". */
export async function fetchStoreInfo(store: StoreAuth): Promise<{ name: string | null; url: string | null }> {
  try {
    const { data } = await nuvemshopRequest<StoreInfo>(store, "GET", "/store");
    const raw = data?.name;
    const name = typeof raw === "string" ? raw : raw ? (raw.pt ?? raw["pt-BR"] ?? Object.values(raw)[0] ?? null) : null;
    const url = data?.url_with_protocol ?? (data?.main_domain || data?.original_domain ? `https://${data.main_domain || data.original_domain}` : null);
    return { name: name ? String(name).slice(0, 200) : null, url };
  } catch (err) {
    console.error("[nuvemshop] could not read the store", store.externalStoreId, err instanceof Error ? err.message : "unknown error");
    return { name: null, url: null };
  }
}

/** Subscribes to the events. An event that is already subscribed (422) counts as done. Returns whether all are in place. */
export async function registerWebhooks(store: StoreAuth, origin: string): Promise<boolean> {
  const url = webhookUrl(origin);
  let ok = true;
  for (const event of WEBHOOK_EVENTS) {
    try {
      await nuvemshopRequest(store, "POST", "/webhooks", { event, url });
    } catch (err) {
      if (err instanceof NuvemshopError && err.status === 422) continue;
      ok = false;
      console.error("[nuvemshop] could not register webhook", event, store.externalStoreId, err instanceof Error ? err.message : "unknown error");
    }
  }
  return ok;
}

/** Removes the subscriptions that point to this CRM (best effort). */
export async function removeWebhooks(store: StoreAuth, origin: string): Promise<void> {
  const url = webhookUrl(origin);
  try {
    const { data } = await nuvemshopRequest<{ id: number; url: string }[]>(store, "GET", "/webhooks");
    for (const hook of data ?? []) {
      if (hook.url === url) await nuvemshopRequest(store, "DELETE", `/webhooks/${hook.id}`).catch(() => undefined);
    }
  } catch (err) {
    console.error("[nuvemshop] could not remove webhooks", store.externalStoreId, err instanceof Error ? err.message : "unknown error");
  }
}

export type InstallResult =
  | { ok: true; integration: Integration }
  | { ok: false; reason: "client_has_other_store" | "not_configured" | "exchange_failed" };

/**
 * `clientId` comes from the signed state (install started in the CRM). Without
 * it (the store installed from Nuvemshop's own admin) the store waits, unlinked,
 * for the team — unless it was already linked before: a reinstall keeps its client.
 */
export async function completeInstall(
  input: { code: string; clientId: string | null; origin: string },
  admin: SupabaseClient = supabaseAdmin(),
): Promise<InstallResult> {
  if (!nuvemshopConfig()) return { ok: false, reason: "not_configured" };

  let exchanged: Awaited<ReturnType<typeof exchangeCode>>;
  try {
    exchanged = await exchangeCode(input.code);
  } catch (err) {
    console.error("[nuvemshop] install failed:", err instanceof Error ? err.message : "unknown error");
    return { ok: false, reason: "exchange_failed" };
  }

  const existing = await getIntegrationByStoreId(exchanged.storeId, admin);
  const clientId = input.clientId ?? existing?.client_id ?? null;

  if (clientId) {
    const other = await getIntegrationForClient(clientId, admin);
    if (other && other.external_store_id !== exchanged.storeId) return { ok: false, reason: "client_has_other_store" };
  }

  const auth: StoreAuth = { externalStoreId: exchanged.storeId, token: exchanged.token };
  const info = await fetchStoreInfo(auth);
  const integration = await saveIntegration(
    { clientId, storeId: exchanged.storeId, storeName: info.name, storeUrl: info.url, token: exchanged.token, scopes: exchanged.scopes },
    admin,
  );

  const webhooksOk = await registerWebhooks(auth, input.origin);
  await patchIntegration(integration.id, { webhooks_ok: webhooksOk }, admin);
  return { ok: true, integration: { ...integration, webhooks_ok: webhooksOk } };
}
