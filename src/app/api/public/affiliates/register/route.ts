// POST /api/public/affiliates/register — public sign-up to a campaign.
//
// No auth. Creates (1) a Supabase Auth user flagged app_metadata.aff_portal
// (migration 101: no CRM account/profile is created for it), (2) the affiliate
// record and (3) a PENDING membership with a coupon code, recording which
// version of the rules was accepted. The store/Aureon approves afterwards.
//
// Refuses to run until migration 101 is applied (aff_portal_ready), otherwise
// every sign-up would become the owner of a brand-new CRM account.
// The e-mail is created as confirmed: the human approval step is the check.

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/contracts/admin-client";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { BadInput } from "@/lib/affiliates/campaigns";
import { couponCandidate, parseRegisterInput } from "@/lib/affiliates/registration";
import { clientIp, isPortalReady, portalNotReadyResponse } from "@/lib/affiliates/portal";

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

const EMAIL_TAKEN = {
  error:
    "Não foi possível concluir o cadastro com este e-mail. Se você já tem cadastro, entre no portal e participe da campanha por lá.",
};

export async function POST(request: Request) {
  const limit = checkRateLimit(`aff-signup:${clientIp(request)}`, RATE_LIMITS.affiliateSignup);
  if (!limit.success) return rateLimitResponse(limit);

  let createdUserId: string | null = null;
  const admin = supabaseAdmin();
  try {
    const input = parseRegisterInput(await request.json().catch(() => null));

    if (!(await isPortalReady(admin))) return portalNotReadyResponse();

    const found = await admin
      .from("aff_campaigns")
      .select("id, client_id, name, policy, status, revision, end_date, aff_clients(status)")
      .eq("id", input.campaign_id)
      .maybeSingle();
    if (found.error) {
      console.error("[register] campaign lookup failed:", found.error.message);
      return NextResponse.json({ error: "Failed to register" }, { status: 500 });
    }
    const campaign = found.data as unknown as {
      id: string;
      client_id: string;
      policy: string;
      status: string;
      revision: number;
      end_date: string | null;
      aff_clients: { status: string } | null;
    } | null;
    if (!campaign || campaign.aff_clients?.status !== "active") {
      return NextResponse.json({ error: "Campanha não encontrada." }, { status: 404 });
    }
    if (campaign.status !== "active" || (campaign.end_date && today() > campaign.end_date)) {
      return NextResponse.json({ error: "Esta campanha não está recebendo novas inscrições." }, { status: 409 });
    }
    if (campaign.revision !== input.revision) {
      return NextResponse.json(
        { error: "As regras da campanha foram atualizadas. Recarregue a página para ler e aceitar a nova versão." },
        { status: 409 },
      );
    }

    const existing = await admin.from("aff_affiliates").select("id").eq("email", input.email).maybeSingle();
    if (existing.error) return NextResponse.json({ error: "Failed to register" }, { status: 500 });
    if (existing.data) return NextResponse.json(EMAIL_TAKEN, { status: 409 });

    const user = await admin.auth.admin.createUser({
      email: input.email,
      password: input.password,
      email_confirm: true,
      app_metadata: { aff_portal: true },
      user_metadata: { full_name: input.name },
    });
    if (user.error || !user.data.user) {
      const msg = user.error?.message ?? "";
      if (/already|registered|exists/i.test(msg)) return NextResponse.json(EMAIL_TAKEN, { status: 409 });
      if (/password/i.test(msg)) return NextResponse.json({ error: "Escolha uma senha mais forte." }, { status: 400 });
      console.error("[register] createUser failed:", msg);
      return NextResponse.json({ error: "Failed to register" }, { status: 500 });
    }
    createdUserId = user.data.user.id;

    // Defense in depth: a portal user must never own a CRM profile.
    const profile = await admin.from("profiles").select("user_id").eq("user_id", createdUserId).maybeSingle();
    if (profile.data) {
      console.error("[register] CRITICAL: portal user got a CRM profile — rolling back", createdUserId);
      await admin.auth.admin.deleteUser(createdUserId);
      createdUserId = null;
      return portalNotReadyResponse();
    }

    const affiliate = await admin
      .from("aff_affiliates")
      .insert({ user_id: createdUserId, name: input.name, email: input.email, instagram: input.instagram })
      .select("id")
      .single();
    if (affiliate.error) {
      await admin.auth.admin.deleteUser(createdUserId);
      createdUserId = null;
      if (affiliate.error.code === "23505") return NextResponse.json(EMAIL_TAKEN, { status: 409 });
      console.error("[register] affiliate insert failed:", affiliate.error.message);
      return NextResponse.json({ error: "Failed to register" }, { status: 500 });
    }

    let membershipId: string | null = null;
    for (let attempt = 0; attempt < 12 && !membershipId; attempt++) {
      const m = await admin
        .from("aff_memberships")
        .insert({
          client_id: campaign.client_id,
          campaign_id: campaign.id,
          affiliate_id: affiliate.data.id,
          code: couponCandidate(input.name, attempt),
          status: "pending",
          accepted_revision: campaign.revision,
          accepted_policy: campaign.policy,
          accepted_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (!m.error) {
        membershipId = m.data.id;
      } else if (m.error.code !== "23505") {
        console.error("[register] membership insert failed:", m.error.message);
        break;
      }
    }
    if (!membershipId) {
      await admin.from("aff_affiliates").delete().eq("id", affiliate.data.id);
      await admin.auth.admin.deleteUser(createdUserId);
      createdUserId = null;
      return NextResponse.json({ error: "Failed to register" }, { status: 500 });
    }

    const { error: auditErr } = await admin.from("aff_audit").insert({
      client_id: campaign.client_id,
      actor_user_id: createdUserId,
      actor_name: input.name,
      actor_kind: "affiliate",
      action: "Inscreveu-se na campanha",
      object_type: "membership",
      object_id: membershipId,
    });
    if (auditErr) console.error("[register] audit insert failed:", auditErr.message);

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    if (createdUserId) await admin.auth.admin.deleteUser(createdUserId).catch(() => undefined);
    if (err instanceof BadInput) return NextResponse.json({ error: err.message }, { status: 400 });
    console.error("[register] unexpected:", err);
    return NextResponse.json({ error: "Failed to register" }, { status: 500 });
  }
}
