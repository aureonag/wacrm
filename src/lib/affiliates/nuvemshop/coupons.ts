// Keeps the coupons of the store in step with the participants (server-only).
//
// A participant has a coupon in the store exactly while they are approved AND
// their campaign is active. Everything here is best effort and idempotent: a
// failure is recorded on the participant (aff_membership_coupons.last_error, so
// the team sees it in Integrações) and never breaks the action that triggered it.

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/contracts/admin-client";
import { nuvemshopRequest, NuvemshopError, type StoreAuth } from "./api";
import { buildCouponPayload, couponShouldExist, type CouponCampaign } from "./coupon-payload";
import { getIntegrationForClient, getStoreAuth, type Integration } from "./store";

interface MembershipForCoupon {
  id: string;
  client_id: string;
  code: string;
  status: string;
  aff_campaigns: (CouponCampaign & { status: "active" | "inactive" }) | null;
}

const MEMBERSHIP_SELECT = "id, client_id, code, status, aff_campaigns(status, discount_type, discount, start_date, end_date)";

export type CouponOutcome = "created" | "updated" | "removed" | "unchanged" | "error";

interface Existing {
  external_coupon_id: string | null;
  state: string;
}

async function record(
  admin: SupabaseClient,
  membershipId: string,
  integrationId: string,
  patch: { external_coupon_id: string | null; state: "synced" | "error" | "removed"; last_error: string | null },
) {
  const { error } = await admin.from("aff_membership_coupons").upsert(
    {
      membership_id: membershipId,
      integration_id: integrationId,
      ...patch,
      synced_at: patch.state === "error" ? null : new Date().toISOString(),
    },
    { onConflict: "membership_id" },
  );
  if (error) console.error("[nuvemshop] could not record coupon state", membershipId, error.message);
}

function friendly(err: unknown): string {
  if (err instanceof NuvemshopError) {
    if (err.status === 422) return `A Nuvemshop recusou o cupom (o código já existe na loja?): ${err.message}`.slice(0, 300);
    if (err.status === 401 || err.status === 403) return "A loja não autoriza mais o app. Reconecte a Nuvemshop.";
    return `Nuvemshop: ${err.message}`.slice(0, 300);
  }
  return "Não foi possível falar com a Nuvemshop.";
}

/** Brings ONE participant's coupon to the state it should be in. */
async function syncOne(
  admin: SupabaseClient,
  store: StoreAuth,
  integrationId: string,
  m: MembershipForCoupon,
  existing: Existing | undefined,
): Promise<CouponOutcome> {
  const campaign = m.aff_campaigns;
  if (!campaign) return "unchanged";
  const wanted = couponShouldExist(m.status, campaign.status);
  const couponId = existing?.external_coupon_id ?? null;

  try {
    if (!wanted) {
      if (!couponId) return "unchanged";
      try {
        await nuvemshopRequest(store, "DELETE", `/coupons/${couponId}`);
      } catch (err) {
        if (!(err instanceof NuvemshopError && err.status === 404)) throw err;
      }
      await record(admin, m.id, integrationId, { external_coupon_id: null, state: "removed", last_error: null });
      return "removed";
    }

    const payload = buildCouponPayload(m.code, campaign);
    if (couponId) {
      try {
        await nuvemshopRequest(store, "PUT", `/coupons/${couponId}`, payload);
        await record(admin, m.id, integrationId, { external_coupon_id: couponId, state: "synced", last_error: null });
        return existing?.state === "synced" ? "updated" : "created";
      } catch (err) {
        // Someone deleted it in the store: create it again below.
        if (!(err instanceof NuvemshopError && err.status === 404)) throw err;
      }
    }
    const { data } = await nuvemshopRequest<{ id: number | string }>(store, "POST", "/coupons", payload);
    await record(admin, m.id, integrationId, { external_coupon_id: String(data.id), state: "synced", last_error: null });
    return "created";
  } catch (err) {
    console.error("[nuvemshop] coupon sync failed", m.id, err instanceof Error ? err.message : "unknown error");
    await record(admin, m.id, integrationId, { external_coupon_id: couponId, state: "error", last_error: friendly(err) });
    return "error";
  }
}

async function loadExisting(admin: SupabaseClient, ids: string[]): Promise<Map<string, Existing>> {
  const map = new Map<string, Existing>();
  if (ids.length === 0) return map;
  const { data } = await admin.from("aff_membership_coupons").select("membership_id, external_coupon_id, state").in("membership_id", ids);
  for (const r of data ?? []) map.set(r.membership_id as string, { external_coupon_id: r.external_coupon_id as string | null, state: r.state as string });
  return map;
}

/** The connected store of a client with its credentials, or null (nothing to do). */
async function storeOf(admin: SupabaseClient, clientId: string): Promise<{ integration: Integration; auth: StoreAuth } | null> {
  const integration = await getIntegrationForClient(clientId, admin);
  if (!integration || integration.status !== "connected") return null;
  const auth = await getStoreAuth(integration.id, admin);
  return auth ? { integration, auth } : null;
}

async function syncMemberships(admin: SupabaseClient, clientId: string, filter: (q: ReturnType<typeof baseQuery>) => ReturnType<typeof baseQuery>) {
  const store = await storeOf(admin, clientId);
  if (!store) return null;
  const { data, error } = await filter(baseQuery(admin, clientId));
  if (error) throw new Error(`memberships read failed: ${error.message}`);
  const memberships = (data ?? []) as unknown as MembershipForCoupon[];
  const existing = await loadExisting(admin, memberships.map((m) => m.id));
  const summary: Record<CouponOutcome, number> = { created: 0, updated: 0, removed: 0, unchanged: 0, error: 0 };
  for (const m of memberships) summary[await syncOne(admin, store.auth, store.integration.id, m, existing.get(m.id))]++;
  return summary;
}

function baseQuery(admin: SupabaseClient, clientId: string) {
  return admin.from("aff_memberships").select(MEMBERSHIP_SELECT).eq("client_id", clientId);
}

/** After a participant is approved / rejected / switched off / created. Never throws. */
export async function syncMembershipCoupon(membershipId: string, admin: SupabaseClient = supabaseAdmin()): Promise<void> {
  try {
    const { data } = await admin.from("aff_memberships").select("client_id").eq("id", membershipId).maybeSingle();
    if (!data) return;
    await syncMemberships(admin, data.client_id as string, (q) => q.eq("id", membershipId));
  } catch (err) {
    console.error("[nuvemshop] syncMembershipCoupon", membershipId, err instanceof Error ? err.message : "unknown error");
  }
}

/** After a campaign is edited / activated / deactivated. Never throws. */
export async function syncCampaignCoupons(clientId: string, campaignId: string, admin: SupabaseClient = supabaseAdmin()): Promise<void> {
  try {
    await syncMemberships(admin, clientId, (q) => q.eq("campaign_id", campaignId));
  } catch (err) {
    console.error("[nuvemshop] syncCampaignCoupons", campaignId, err instanceof Error ? err.message : "unknown error");
  }
}

/** Every participant of the client: the manual "Sincronizar cupons" button and right after connecting. Null when no store is connected. */
export async function syncClientCoupons(clientId: string, admin: SupabaseClient = supabaseAdmin()) {
  return syncMemberships(admin, clientId, (q) => q);
}

/** Deletes the coupons this CRM created in the store (disconnecting). Best effort. */
export async function removeClientCoupons(admin: SupabaseClient, store: StoreAuth, integrationId: string): Promise<void> {
  const { data } = await admin.from("aff_membership_coupons").select("membership_id, external_coupon_id").eq("integration_id", integrationId);
  for (const row of data ?? []) {
    if (!row.external_coupon_id) continue;
    try {
      await nuvemshopRequest(store, "DELETE", `/coupons/${row.external_coupon_id}`);
    } catch (err) {
      if (!(err instanceof NuvemshopError && err.status === 404)) {
        console.error("[nuvemshop] could not delete a coupon", row.membership_id, err instanceof Error ? err.message : "unknown error");
      }
    }
  }
}
