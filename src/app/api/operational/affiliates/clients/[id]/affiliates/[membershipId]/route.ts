// PATCH /api/operational/affiliates/clients/:id/affiliates/:membershipId
//   body { status: 'approved' | 'rejected' | 'inactive' }
//
// Approve / reject a sign-up, or switch an approved participant off (and back
// on). Staff only — see src/lib/affiliates/admin.ts.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { isModuleNotReady, moduleNotReadyResponse, requireClientAccess, writeAudit } from "@/lib/affiliates/admin";
import { isUuid } from "@/lib/affiliates/campaigns";

const ACTION: Record<string, string> = {
  approved: "Aprovou afiliado",
  rejected: "Recusou afiliado",
  inactive: "Desativou afiliado",
};

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
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
