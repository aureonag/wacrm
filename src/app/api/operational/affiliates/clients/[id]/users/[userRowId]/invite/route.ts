// POST /api/operational/affiliates/clients/:id/users/:userRowId/invite
// (Re)sends the "set your password" link to a person of the store.
// Aureon staff, or a store user with team permission.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { isModuleNotReady, moduleNotReadyResponse, requireClientAccess, writeAudit } from "@/lib/affiliates/admin";
import { isUuid } from "@/lib/affiliates/campaigns";
import { sendInvite } from "@/lib/affiliates/portal-access";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { isEmailConfigured } from "@/lib/contracts/email";

export async function POST(req: Request, { params }: { params: Promise<{ id: string; userRowId: string }> }) {
  try {
    const { id, userRowId } = await params;
    if (!isUuid(id) || !isUuid(userRowId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { ctx, admin } = await requireClientAccess(id, [["team", "edit"]]);

    if (!isEmailConfigured()) {
      return NextResponse.json({ error: "O envio de e-mail ainda não está configurado neste ambiente." }, { status: 503 });
    }

    const row = await admin
      .from("aff_client_users")
      .select("name, email, status, aff_clients(name)")
      .eq("id", userRowId)
      .eq("client_id", id)
      .maybeSingle();
    if (row.error) {
      if (isModuleNotReady(row.error)) return moduleNotReadyResponse();
      return NextResponse.json({ error: "Failed to send invite" }, { status: 500 });
    }
    if (!row.data) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (row.data.status !== "active") return NextResponse.json({ error: "Reative a pessoa antes de enviar o convite." }, { status: 409 });

    const limit = checkRateLimit(`portal-invite:${row.data.email.toLowerCase()}`, RATE_LIMITS.portalAccessCode);
    if (!limit.success) return rateLimitResponse(limit);

    try {
      await sendInvite(admin, req, {
        email: row.data.email.toLowerCase(),
        name: row.data.name,
        store: (row.data.aff_clients as unknown as { name: string } | null)?.name ?? null,
      });
    } catch (err) {
      console.error("[users/invite] send failed:", err);
      if (/aff_access_codes/.test(String((err as Error)?.message))) {
        return NextResponse.json({ error: "portal_not_ready" }, { status: 503 });
      }
      return NextResponse.json({ error: "Não foi possível enviar o e-mail. Tente novamente em instantes." }, { status: 502 });
    }

    await writeAudit(admin, ctx, { clientId: id, action: "Enviou convite à equipe", objectType: "client_user", objectId: userRowId });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
