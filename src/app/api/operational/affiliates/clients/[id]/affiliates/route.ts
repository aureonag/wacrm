// GET  /api/operational/affiliates/clients/:id/affiliates — participants of one
//                                       client (one row per affiliate × campaign).
// POST /api/operational/affiliates/clients/:id/affiliates — register an affiliate
//                                       by hand and attach them to a campaign
//                                       with a coupon code (approved right away).
//
// The portal login for the affiliate does not exist yet (migration 101); this
// only creates the record. Staff only — see src/lib/affiliates/admin.ts.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import {
  BadInput,
  isModuleNotReady,
  moduleNotReadyResponse,
  requireClientAccess,
  writeAudit,
} from "@/lib/affiliates/admin";
import { isUuid, parseAffiliateInput } from "@/lib/affiliates/campaigns";

interface MembershipRow {
  id: string;
  code: string;
  status: "pending" | "approved" | "rejected" | "inactive";
  accepted_revision: number | null;
  accepted_at: string | null;
  created_at: string;
  campaign_id: string;
  aff_campaigns: { name: string } | null;
  aff_affiliates: {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    instagram: string | null;
    pix_key: string | null;
    user_id: string | null;
  } | null;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { admin } = await requireClientAccess(id, [["affiliates", "view"]]);

    const { data, error } = await admin
      .from("aff_memberships")
      .select(
        "id, code, status, accepted_revision, accepted_at, created_at, campaign_id, aff_campaigns(name), aff_affiliates(id, name, email, phone, instagram, pix_key, user_id)",
      )
      .eq("client_id", id)
      .order("created_at", { ascending: false });
    if (error) {
      if (isModuleNotReady(error)) return moduleNotReadyResponse();
      console.error("[GET affiliates/affiliates]", error.message);
      return NextResponse.json({ error: "Failed to load affiliates" }, { status: 500 });
    }

    const rows = (data ?? []) as unknown as MembershipRow[];
    return NextResponse.json({
      memberships: rows.map((m) => ({
        id: m.id,
        code: m.code,
        status: m.status,
        accepted_revision: m.accepted_revision,
        accepted_at: m.accepted_at,
        created_at: m.created_at,
        campaign_id: m.campaign_id,
        campaign_name: m.aff_campaigns?.name ?? "",
        affiliate: m.aff_affiliates
          ? {
              id: m.aff_affiliates.id,
              name: m.aff_affiliates.name,
              email: m.aff_affiliates.email,
              phone: m.aff_affiliates.phone,
              instagram: m.aff_affiliates.instagram,
              has_pix: Boolean(m.aff_affiliates.pix_key),
              has_login: Boolean(m.aff_affiliates.user_id),
            }
          : null,
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { ctx, admin } = await requireClientAccess(id, [["affiliates", "edit"]]);
    const input = parseAffiliateInput(await req.json().catch(() => null));

    const campaign = await admin
      .from("aff_campaigns")
      .select("id, status")
      .eq("id", input.campaign_id)
      .eq("client_id", id)
      .maybeSingle();
    if (campaign.error) {
      if (isModuleNotReady(campaign.error)) return moduleNotReadyResponse();
      return NextResponse.json({ error: "Failed to create affiliate" }, { status: 500 });
    }
    if (!campaign.data) return NextResponse.json({ error: "Campanha não encontrada." }, { status: 400 });
    if (campaign.data.status !== "active") {
      return NextResponse.json({ error: "Escolha uma campanha ativa." }, { status: 400 });
    }

    // The same person can take part in several clients/campaigns: reuse the
    // affiliate record when the e-mail is already registered (emails are stored
    // lowercase), never overwrite their data.
    let affiliateId: string;
    let createdAffiliate = false;
    const existing = await admin.from("aff_affiliates").select("id").eq("email", input.email).maybeSingle();
    if (existing.error) return NextResponse.json({ error: "Failed to create affiliate" }, { status: 500 });
    if (existing.data) {
      affiliateId = existing.data.id;
    } else {
      const created = await admin
        .from("aff_affiliates")
        .insert({
          name: input.name,
          email: input.email,
          phone: input.phone,
          instagram: input.instagram,
          pix_key_type: input.pix_key_type,
          pix_key: input.pix_key,
        })
        .select("id")
        .single();
      if (created.error) {
        console.error("[POST affiliates/affiliates] affiliate", created.error.message);
        return NextResponse.json({ error: "Failed to create affiliate" }, { status: 500 });
      }
      affiliateId = created.data.id;
      createdAffiliate = true;
    }

    const membership = await admin
      .from("aff_memberships")
      .insert({
        client_id: id,
        campaign_id: input.campaign_id,
        affiliate_id: affiliateId,
        code: input.code,
        status: "approved",
      })
      .select("id")
      .single();
    if (membership.error) {
      if (createdAffiliate) await admin.from("aff_affiliates").delete().eq("id", affiliateId);
      if (membership.error.code === "23505") {
        return NextResponse.json(
          { error: "Este afiliado já participa da campanha ou o código do cupom já está em uso nesta loja." },
          { status: 409 },
        );
      }
      console.error("[POST affiliates/affiliates] membership", membership.error.message);
      return NextResponse.json({ error: "Failed to create affiliate" }, { status: 500 });
    }

    await writeAudit(admin, ctx, {
      clientId: id,
      action: "Cadastrou afiliado",
      objectType: "membership",
      objectId: membership.data.id,
    });
    return NextResponse.json({ id: membership.data.id }, { status: 201 });
  } catch (err) {
    if (err instanceof BadInput) return NextResponse.json({ error: err.message }, { status: 400 });
    return toErrorResponse(err);
  }
}
