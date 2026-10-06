// POST /api/operational/affiliates/clients/:id/affiliates/:membershipId/invite
// E-mails the affiliate a link to set a password and enter the portal. This is
// how an affiliate registered by hand (no login yet) gets access; for one who
// already has a login it works as a "set a new password" link.
// Aureon staff, or a store user who can edit affiliates.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { isModuleNotReady, moduleNotReadyResponse, requireClientAccess, writeAudit } from "@/lib/affiliates/admin";
import { isUuid } from "@/lib/affiliates/campaigns";
import { sendInvite } from "@/lib/affiliates/portal-access";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { isEmailConfigured } from "@/lib/contracts/email";

export async function POST(req: Request, { params }: { params: Promise<{ id: string; membershipId: string }> }) {
  try {
    const { id, membershipId } = await params;
    if (!isUuid(id) || !isUuid(membershipId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { ctx, admin } = await requireClientAccess(id, [["affiliates", "edit"]]);

    if (!isEmailConfigured()) {
      return NextResponse.json({ error: "O envio de e-mail ainda não está configurado neste ambiente." }, { status: 503 });
    }

    const row = await admin
      .from("aff_memberships")
      .select("id, aff_affiliates(name, email, status), aff_clients(name)")
      .eq("id", membershipId)
      .eq("client_id", id)
      .maybeSingle();
    if (row.error) {
      if (isModuleNotReady(row.error)) return moduleNotReadyResponse();
      return NextResponse.json({ error: "Failed to send invite" }, { status: 500 });
    }
    const m = row.data as unknown as {
      aff_affiliates: { name: string; email: string; status: string } | null;
      aff_clients: { name: string } | null;
    } | null;
    if (!m?.aff_affiliates) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (m.aff_affiliates.status !== "active") return NextResponse.json({ error: "Afiliado desativado." }, { status: 409 });

    const email = m.aff_affiliates.email.toLowerCase();
    const limit = checkRateLimit(`portal-invite:${email}`, RATE_LIMITS.portalAccessCode);
    if (!limit.success) return rateLimitResponse(limit);

    try {
      await sendInvite(admin, req, { email, name: m.aff_affiliates.name, store: m.aff_clients?.name ?? null });
    } catch (err) {
      console.error("[affiliates/invite] send failed:", err);
      if (/aff_access_codes/.test(String((err as Error)?.message))) {
        return NextResponse.json({ error: "portal_not_ready" }, { status: 503 });
      }
      return NextResponse.json({ error: "Não foi possível enviar o e-mail. Tente novamente em instantes." }, { status: 502 });
    }

    await writeAudit(admin, ctx, { clientId: id, action: "Enviou convite ao afiliado", objectType: "membership", objectId: membershipId });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
