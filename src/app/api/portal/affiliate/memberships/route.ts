// POST /api/portal/affiliate/memberships — a logged-in affiliate joins another
// campaign (body { campaign_id, revision, accept: true }). Lands as PENDING with
// a generated coupon code, recording the accepted rules version.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { BadInput, isUuid } from "@/lib/affiliates/campaigns";
import { requireAffiliate, writeAffiliateAudit } from "@/lib/affiliates/portal";
import { couponCandidate } from "@/lib/affiliates/registration";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

export async function POST(request: Request) {
  try {
    const ctx = await requireAffiliate();
    const limit = checkRateLimit(`aff-portal-write:${ctx.userId}`, RATE_LIMITS.affiliatePortalWrite);
    if (!limit.success) return rateLimitResponse(limit);

    const b = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    if (!isUuid(b.campaign_id)) throw new BadInput("Campanha inválida.");
    if (b.accept !== true) throw new BadInput("É preciso aceitar as regras da campanha.");
    const revision = Number(b.revision);

    const found = await ctx.admin
      .from("aff_campaigns")
      .select("id, client_id, policy, status, revision, end_date, aff_clients(status)")
      .eq("id", b.campaign_id)
      .maybeSingle();
    if (found.error) return NextResponse.json({ error: "Failed to join" }, { status: 500 });
    const c = found.data as unknown as {
      id: string;
      client_id: string;
      policy: string;
      status: string;
      revision: number;
      end_date: string | null;
      aff_clients: { status: string } | null;
    } | null;
    if (!c || c.aff_clients?.status !== "active") return NextResponse.json({ error: "Campanha não encontrada." }, { status: 404 });
    if (c.status !== "active" || (c.end_date && today() > c.end_date)) {
      return NextResponse.json({ error: "Esta campanha não está recebendo novas inscrições." }, { status: 409 });
    }
    if (c.revision !== revision) {
      return NextResponse.json({ error: "As regras da campanha foram atualizadas. Recarregue a página." }, { status: 409 });
    }

    let membershipId: string | null = null;
    for (let attempt = 0; attempt < 12 && !membershipId; attempt++) {
      const m = await ctx.admin
        .from("aff_memberships")
        .insert({
          client_id: c.client_id,
          campaign_id: c.id,
          affiliate_id: ctx.affiliate.id,
          code: couponCandidate(ctx.affiliate.name, attempt),
          status: "pending",
          accepted_revision: c.revision,
          accepted_policy: c.policy,
          accepted_at: new Date().toISOString(),
        })
        .select("id, code")
        .single();
      if (!m.error) {
        membershipId = m.data.id;
        continue;
      }
      if (m.error.code !== "23505") {
        console.error("[portal/memberships] insert failed:", m.error.message);
        return NextResponse.json({ error: "Failed to join" }, { status: 500 });
      }
      // Either the code collided (retry) or this affiliate already joined.
      const already = await ctx.admin
        .from("aff_memberships")
        .select("id")
        .eq("campaign_id", c.id)
        .eq("affiliate_id", ctx.affiliate.id)
        .maybeSingle();
      if (already.data) return NextResponse.json({ error: "Você já participa desta campanha." }, { status: 409 });
    }
    if (!membershipId) return NextResponse.json({ error: "Failed to join" }, { status: 500 });

    await writeAffiliateAudit(ctx.admin, ctx, {
      clientId: c.client_id,
      action: "Inscreveu-se na campanha",
      objectType: "membership",
      objectId: membershipId,
    });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    if (err instanceof BadInput) return NextResponse.json({ error: err.message }, { status: 400 });
    return toErrorResponse(err);
  }
}
