// Server helpers for the Afiliados PORTAL (public sign-up + logged-in affiliate).
//
// Portal users are Supabase Auth users WITHOUT a CRM profile, flagged with
// app_metadata.aff_portal = true (migration 101). They never touch CRM data:
// every portal route resolves the affiliate from the session and scopes every
// query by that affiliate_id using the service-role client.

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ForbiddenError, UnauthorizedError } from "@/lib/auth/account";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/contracts/admin-client";

export interface AffiliateContext {
  userId: string;
  affiliate: { id: string; name: string; email: string };
  admin: SupabaseClient;
}

/** Resolves the logged-in affiliate. Throws Unauthorized / Forbidden. */
export async function requireAffiliate(): Promise<AffiliateContext> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) throw new UnauthorizedError();
  if (user.app_metadata?.aff_portal !== true) throw new ForbiddenError("Not an affiliate account");

  const admin = supabaseAdmin();
  const { data, error: lookupErr } = await admin
    .from("aff_affiliates")
    .select("id, name, email, status")
    .eq("user_id", user.id)
    .maybeSingle();
  if (lookupErr) {
    console.error("[affiliates/portal] affiliate lookup failed:", lookupErr.message);
    throw new ForbiddenError("Could not load affiliate");
  }
  if (!data || data.status !== "active") throw new ForbiddenError("Affiliate account is not active");
  return { userId: user.id, affiliate: { id: data.id, name: data.name, email: data.email }, admin };
}

/** True once migration 101 is applied (see aff_portal_ready()). */
export async function isPortalReady(admin: SupabaseClient): Promise<boolean> {
  const { data, error } = await admin.rpc("aff_portal_ready");
  return !error && data === true;
}

export function portalNotReadyResponse(): NextResponse {
  return NextResponse.json({ error: "portal_not_ready" }, { status: 503 });
}

export function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return request.headers.get("x-real-ip")?.trim() ?? "unknown";
}

export async function writeAffiliateAudit(
  admin: SupabaseClient,
  ctx: AffiliateContext,
  entry: { clientId: string | null; action: string; objectType: string; objectId: string },
): Promise<void> {
  const { error } = await admin.from("aff_audit").insert({
    client_id: entry.clientId,
    actor_user_id: ctx.userId,
    actor_name: ctx.affiliate.name,
    actor_kind: "affiliate",
    action: entry.action,
    object_type: entry.objectType,
    object_id: entry.objectId,
  });
  if (error) console.error("[affiliates/portal] audit insert failed:", error.message);
}
