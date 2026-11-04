// Turns Nuvemshop orders into aff_orders (server-only).
//
// An order counts for an affiliate when it used the coupon of an approved
// participant of the client the store is linked to. The commission side only
// ever looks at status = "paid": a pending order is shown but earns nothing, and
// a cancelled / refunded one drops out. Webhooks arrive repeated and out of
// order, so everything here is an idempotent upsert keyed by (client, order id).

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/contracts/admin-client";
import { nuvemshopRequest, NuvemshopError } from "./api";
import { parseOrder } from "./orders";
import { getIntegrationByStoreId, getStoreAuth, type Integration } from "./store";

export type IngestResult = "stored" | "updated" | "ignored";

/** Stores or refreshes ONE order of a linked store. `raw` is the order as the API returns it. */
export async function ingestOrder(admin: SupabaseClient, integration: Integration, raw: unknown): Promise<IngestResult> {
  const clientId = integration.client_id;
  if (!clientId) return "ignored"; // the store is not linked to a client yet
  const order = parseOrder(raw);
  if (!order) return "ignored";

  const known = await admin
    .from("aff_orders")
    .select("id")
    .eq("client_id", clientId)
    .eq("external_id", order.externalId)
    .maybeSingle();
  if (known.error) throw new Error(`aff_orders read failed: ${known.error.message}`);

  if (known.data) {
    // Already attributed: only what changes over the life of the order.
    const { error } = await admin
      .from("aff_orders")
      .update({ status: order.status, total_cents: order.totalCents, paid_at: order.paidAt })
      .eq("id", known.data.id);
    if (error) throw new Error(`aff_orders update failed: ${error.message}`);
    return "updated";
  }

  if (order.couponCodes.length === 0) return "ignored";
  const { data: members, error: memberErr } = await admin
    .from("aff_memberships")
    .select("id, affiliate_id, code")
    .eq("client_id", clientId)
    .eq("status", "approved")
    .in("code", order.couponCodes)
    .limit(1);
  if (memberErr) throw new Error(`aff_memberships read failed: ${memberErr.message}`);
  const member = members?.[0];
  if (!member) return "ignored"; // a coupon of the store itself, not an affiliate's

  const { error } = await admin.from("aff_orders").upsert(
    {
      client_id: clientId,
      integration_id: integration.id,
      membership_id: member.id,
      affiliate_id: member.affiliate_id,
      external_id: order.externalId,
      coupon_code: member.code,
      total_cents: order.totalCents,
      status: order.status,
      ordered_at: order.orderedAt ?? new Date().toISOString(),
      paid_at: order.paidAt,
    },
    { onConflict: "client_id,external_id" },
  );
  if (error) throw new Error(`aff_orders insert failed: ${error.message}`);
  return "stored";
}

/** A webhook said order `orderId` of store `storeId` changed: read it and record it. Never throws. */
export async function processOrderEvent(storeId: string, orderId: string | number): Promise<void> {
  const admin = supabaseAdmin();
  try {
    const integration = await getIntegrationByStoreId(storeId, admin);
    if (!integration || integration.status !== "connected" || !integration.client_id) return;
    const auth = await getStoreAuth(integration.id, admin);
    if (!auth) return;
    try {
      const { data } = await nuvemshopRequest<unknown>(auth, "GET", `/orders/${encodeURIComponent(String(orderId))}`);
      await ingestOrder(admin, integration, data);
    } catch (err) {
      // The order was deleted in the store: it no longer counts.
      if (err instanceof NuvemshopError && err.status === 404) {
        await admin
          .from("aff_orders")
          .update({ status: "cancelled" })
          .eq("client_id", integration.client_id)
          .eq("external_id", String(orderId));
        return;
      }
      throw err;
    }
  } catch (err) {
    console.error("[nuvemshop] processOrderEvent", storeId, orderId, err instanceof Error ? err.message : "unknown error");
  }
}

const IMPORT_MAX_PAGES = 10;

/**
 * Safety net for a webhook that never arrived: reads the store's recent orders
 * (200 a page, up to 10 pages) and records the ones that used an affiliate's coupon.
 */
export async function importRecentOrders(
  integration: Integration,
  days = 30,
  admin: SupabaseClient = supabaseAdmin(),
): Promise<{ read: number; stored: number; updated: number }> {
  const auth = await getStoreAuth(integration.id, admin);
  if (!auth) throw new NuvemshopError("Não foi possível ler as credenciais da loja. Reconecte a Nuvemshop.", 401);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  let path: string | null = `/orders?created_at_min=${encodeURIComponent(since)}&per_page=200`;
  const out = { read: 0, stored: 0, updated: 0 };
  for (let page = 0; path && page < IMPORT_MAX_PAGES; page++) {
    let res: { data: unknown[]; next: string | null };
    try {
      res = await nuvemshopRequest<unknown[]>(auth, "GET", path);
    } catch (err) {
      // A list with no orders is answered with "404 Last page is 0", not with an empty list.
      if (err instanceof NuvemshopError && err.status === 404) break;
      throw err;
    }
    for (const raw of res.data ?? []) {
      out.read++;
      const r = await ingestOrder(admin, integration, raw);
      if (r === "stored") out.stored++;
      if (r === "updated") out.updated++;
    }
    path = res.next;
  }
  return out;
}
