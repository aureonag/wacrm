// GET   /api/operational/affiliates/clients/:id/affiliates/:membershipId
//   -> the profile of one participant: contact data, every campaign they joined
//      in this client, sales and commissions. The Pix key is only returned to
//      whoever may see payments (the Aureon team, finance, owner).
// PATCH /api/operational/affiliates/clients/:id/affiliates/:membershipId
//   body { status: 'approved' | 'rejected' | 'inactive' }
//
// Approve / reject a sign-up, or switch an approved participant off (and back
// on). Staff only — see src/lib/affiliates/admin.ts.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { isModuleNotReady, moduleNotReadyResponse, requireClientAccess, writeAudit } from "@/lib/affiliates/admin";
import { isUuid } from "@/lib/affiliates/campaigns";
import { can } from "@/lib/affiliates/store-access";
import { notifyAffiliate } from "@/lib/affiliates/notifications";

const ACTION: Record<string, string> = {
  approved: "Aprovou afiliado",
  rejected: "Recusou afiliado",
  inactive: "Desativou afiliado",
};

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; membershipId: string }> }) {
  try {
    const { id, membershipId } = await params;
    if (!isUuid(id) || !isUuid(membershipId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { admin, permissions } = await requireClientAccess(id, [["affiliates", "view"]]);

    const current = await admin
      .from("aff_memberships")
      .select("id, affiliate_id, code, status, accepted_revision, accepted_at, created_at, aff_campaigns(name)")
      .eq("id", membershipId)
      .eq("client_id", id)
      .maybeSingle();
    if (current.error) {
      if (isModuleNotReady(current.error)) return moduleNotReadyResponse();
      console.error("[GET affiliates/affiliates/:id]", current.error.message);
      return NextResponse.json({ error: "Failed to load affiliate" }, { status: 500 });
    }
    if (!current.data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const affiliateId = current.data.affiliate_id as string;

    const [affiliate, memberships, orders, commissions] = await Promise.all([
      admin
        .from("aff_affiliates")
        .select("id, name, email, phone, instagram, city, state, pix_key_type, pix_key, created_at")
        .eq("id", affiliateId)
        .maybeSingle(),
      admin
        .from("aff_memberships")
        .select("id, code, status, aff_campaigns(name)")
        .eq("client_id", id)
        .eq("affiliate_id", affiliateId)
        .order("created_at", { ascending: true }),
      admin.from("aff_orders").select("total_cents, status").eq("client_id", id).eq("affiliate_id", affiliateId),
      admin
        .from("aff_commissions")
        .select("id, period, gross_cents, status")
        .eq("client_id", id)
        .eq("affiliate_id", affiliateId)
        .order("period", { ascending: false })
        .limit(12),
    ]);
    for (const r of [affiliate, memberships, orders, commissions]) {
      if (r.error) {
        console.error("[GET affiliates/affiliates/:id]", r.error.message);
        return NextResponse.json({ error: "Failed to load affiliate" }, { status: 500 });
      }
    }
    if (!affiliate.data) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const a = affiliate.data;
    const paid = (orders.data ?? []).filter((o) => o.status === "paid");
    const comm = commissions.data ?? [];
    const seePix = can(permissions, "payments", "view");
    return NextResponse.json({
      membership: {
        id: current.data.id,
        code: current.data.code,
        status: current.data.status,
        accepted_revision: current.data.accepted_revision,
        accepted_at: current.data.accepted_at,
        created_at: current.data.created_at,
        campaign_name: (current.data.aff_campaigns as unknown as { name: string } | null)?.name ?? "",
      },
      affiliate: {
        id: a.id,
        name: a.name,
        email: a.email,
        phone: a.phone,
        instagram: a.instagram,
        city: a.city,
        state: a.state,
        created_at: a.created_at,
        has_pix: Boolean(a.pix_key),
        pix_key_type: seePix ? a.pix_key_type : null,
        pix_key: seePix ? a.pix_key : null,
      },
      memberships: (
        (memberships.data ?? []) as unknown as { id: string; code: string; status: string; aff_campaigns: { name: string } | null }[]
      ).map((m) => ({ id: m.id, code: m.code, status: m.status, campaign_name: m.aff_campaigns?.name ?? "" })),
      totals: {
        sales_cents: paid.reduce((n, o) => n + Number(o.total_cents), 0),
        orders: paid.length,
        cancelled: (orders.data ?? []).filter((o) => o.status === "cancelled").length,
        commissions_cents: comm.reduce((n, c) => n + Number(c.gross_cents), 0),
        paid_cents: comm.filter((c) => c.status === "paid_external").reduce((n, c) => n + Number(c.gross_cents), 0),
      },
      commissions: comm.map((c) => ({ id: c.id, period: c.period, gross_cents: Number(c.gross_cents), status: c.status })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; membershipId: string }> }) {
  try {
    const { id, membershipId } = await params;
    if (!isUuid(id) || !isUuid(membershipId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { ctx, admin } = await requireClientAccess(id, [["affiliates", "edit"]]);

    const body = (await req.json().catch(() => null)) as { status?: unknown } | null;
    const status = body?.status;
    if (typeof status !== "string" || !(status in ACTION)) {
      return NextResponse.json({ error: "Status inválido." }, { status: 400 });
    }

    const before = await admin
      .from("aff_memberships")
      .select("status, affiliate_id, code, aff_campaigns(name)")
      .eq("id", membershipId)
      .eq("client_id", id)
      .maybeSingle();

    const { data, error } = await admin
      .from("aff_memberships")
      .update({ status })
      .eq("id", membershipId)
      .eq("client_id", id)
      .select("id")
      .maybeSingle();
    if (error) {
      if (isModuleNotReady(error)) return moduleNotReadyResponse();
      console.error("[PATCH affiliates/affiliates/:id]", error.message);
      return NextResponse.json({ error: "Failed to update affiliate" }, { status: 500 });
    }
    if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await writeAudit(admin, ctx, {
      clientId: id,
      action: ACTION[status],
      objectType: "membership",
      objectId: membershipId,
    });

    // Tell the affiliate only when the decision really changed.
    if (before.data && before.data.status !== status && (status === "approved" || status === "rejected")) {
      const campaign = (before.data.aff_campaigns as unknown as { name: string } | null)?.name ?? "";
      notifyAffiliate(admin, req, {
        clientId: id,
        affiliateId: before.data.affiliate_id,
        event:
          status === "approved"
            ? { kind: "membership_approved", code: before.data.code, campaign }
            : { kind: "membership_rejected", campaign },
      });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
