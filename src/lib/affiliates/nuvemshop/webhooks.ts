// What to do with a webhook from the Nuvemshop (server-only). The route has
// already checked the HMAC and answered 200; this runs after the response.

import { supabaseAdmin } from "@/lib/contracts/admin-client";
import { processOrderEvent } from "./orders-sync";
import { getIntegrationByStoreId, patchIntegration } from "./store";

export interface WebhookPayload {
  store_id?: number | string;
  event?: string;
  id?: number | string;
}

export function parseWebhookPayload(raw: string): (WebhookPayload & { store_id: number | string; event: string }) | null {
  try {
    const p = JSON.parse(raw) as WebhookPayload;
    if (!p || typeof p !== "object") return null;
    if ((typeof p.store_id !== "number" && typeof p.store_id !== "string") || typeof p.event !== "string") return null;
    return p as WebhookPayload & { store_id: number | string; event: string };
  } catch {
    return null;
  }
}

/** Orders and the app's own lifecycle. Never throws. */
export async function handleWebhookEvent(payload: { store_id: number | string; event: string; id?: number | string }): Promise<void> {
  const storeId = String(payload.store_id);
  try {
    if (payload.event.startsWith("order/")) {
      if (payload.id !== undefined) await processOrderEvent(storeId, payload.id);
      return;
    }
    if (payload.event === "app/uninstalled") {
      // The token is dead from now on: coupons and orders stop syncing until the store installs again.
      const integration = await getIntegrationByStoreId(storeId);
      if (integration) {
        await patchIntegration(integration.id, { status: "revoked", last_error: "O lojista desinstalou o app na Nuvemshop.", webhooks_ok: false });
      }
    }
  } catch (err) {
    console.error("[nuvemshop] webhook", payload.event, storeId, err instanceof Error ? err.message : "unknown error");
  }
}

/**
 * LGPD: sent after the merchant uninstalls. We delete the store's connection
 * (and its token); the coupon records go with it. Orders already attributed
 * stay, as they hold no personal data of the buyer (id, amount, status, coupon).
 */
export async function redactStore(storeId: string): Promise<void> {
  const { error } = await supabaseAdmin().from("aff_integrations").delete().eq("platform", "nuvemshop").eq("external_store_id", storeId);
  if (error) console.error("[nuvemshop] store/redact failed", storeId, error.message);
}
