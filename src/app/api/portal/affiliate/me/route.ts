// GET   /api/portal/affiliate/me — the logged-in affiliate: profile + the
//        campaigns they take part in (only of active stores).
// PATCH /api/portal/affiliate/me — edit own profile (contact, Pix).
//
// Portal user only (aff_portal session). Every query is scoped by the
// affiliate resolved from the session — never by an id from the request.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { BadInput } from "@/lib/affiliates/campaigns";
import { requireAffiliate, writeAffiliateAudit } from "@/lib/affiliates/portal";
import { parseProfileInput } from "@/lib/affiliates/registration";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

interface MembershipRow {
  id: string;
  code: string;
  status: string;
  accepted_revision: number | null;
  created_at: string;
  aff_campaigns: {
    id: string;
    name: string;
    description: string;
    discount_type: string;
    discount: number;
    frequency: string;
    start_date: string;
    end_date: string | null;
    rewards: unknown;
    status: string;
    revision: number;
  } | null;
  aff_clients: { name: string; status: string } | null;
}

export async function GET() {
  try {
    const { admin, affiliate } = await requireAffiliate();

    const [profile, memberships] = await Promise.all([
      admin
        .from("aff_affiliates")
        .select("id, name, email, phone, instagram, city, state, pix_key_type, pix_key")
        .eq("id", affiliate.id)
        .single(),
      admin
        .from("aff_memberships")
        .select(
          "id, code, status, accepted_revision, created_at, aff_campaigns(id, name, description, discount_type, discount, frequency, start_date, end_date, rewards, status, revision), aff_clients(name, status)",
        )
        .eq("affiliate_id", affiliate.id)
        .order("created_at", { ascending: false }),
    ]);
    if (profile.error || memberships.error) {
      console.error("[GET portal/me]", profile.error?.message ?? memberships.error?.message);
      return NextResponse.json({ error: "Failed to load" }, { status: 500 });
    }

    const rows = (memberships.data ?? []) as unknown as MembershipRow[];
    return NextResponse.json({
      profile: profile.data,
      memberships: rows
        .filter((m) => m.aff_clients && m.aff_clients.status === "active" && m.aff_campaigns)
        .map((m) => ({
          id: m.id,
          code: m.code,
          status: m.status,
          accepted_revision: m.accepted_revision,
          store: m.aff_clients!.name,
          campaign: { ...m.aff_campaigns!, discount: Number(m.aff_campaigns!.discount) },
        })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireAffiliate();
    const limit = checkRateLimit(`aff-portal-write:${ctx.userId}`, RATE_LIMITS.affiliatePortalWrite);
    if (!limit.success) return rateLimitResponse(limit);

    const input = parseProfileInput(await request.json().catch(() => null));
    const { error } = await ctx.admin.from("aff_affiliates").update(input).eq("id", ctx.affiliate.id);
    if (error) {
      console.error("[PATCH portal/me]", error.message);
      return NextResponse.json({ error: "Failed to save" }, { status: 500 });
    }
    await writeAffiliateAudit(ctx.admin, ctx, {
      clientId: null,
      action: "Atualizou o próprio perfil",
      objectType: "affiliate",
      objectId: ctx.affiliate.id,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof BadInput) return NextResponse.json({ error: err.message }, { status: 400 });
    return toErrorResponse(err);
  }
}
