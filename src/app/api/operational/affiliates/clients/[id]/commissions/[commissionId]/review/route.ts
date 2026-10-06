// POST /api/operational/affiliates/clients/:id/commissions/:commissionId/review
//   body { approve: true } | { approve: false, reason }
//
// Approving makes the payment available; rejecting sends it back for a new
// upload with the reason. Only from invoice_review.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { BadInput, requireClientAccess, writeAudit } from "@/lib/affiliates/admin";
import { isUuid } from "@/lib/affiliates/campaigns";
import { parseReviewInput } from "@/lib/affiliates/commissions";
import { conflictResponse, loadCommissionFiles } from "@/lib/affiliates/commissions-server";
import { notifyAffiliate } from "@/lib/affiliates/notifications";

export async function POST(req: Request, { params }: { params: Promise<{ id: string; commissionId: string }> }) {
  try {
    const { id, commissionId } = await params;
    if (!isUuid(id) || !isUuid(commissionId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { ctx, admin } = await requireClientAccess(id, [["invoices", "edit"]]);
    const input = parseReviewInput(await req.json().catch(() => null));

    const current = await loadCommissionFiles(admin, id, commissionId);
    if (current instanceof NextResponse) return current;
    if (current.status !== "invoice_review") {
      return NextResponse.json({ error: "Esta comissão não tem nota em análise." }, { status: 409 });
    }

    const { data, error } = await admin
      .from("aff_commissions")
      .update(
        input.approve
          ? { status: "available", invoice_status: "approved", invoice_reason: null }
          : { status: "invoice_rejected", invoice_status: "rejected", invoice_reason: input.reason },
      )
      .eq("id", commissionId)
      .eq("client_id", id)
      .eq("status", "invoice_review")
      .select("id")
      .maybeSingle();
    if (error) {
      console.error("[POST affiliates/commissions/review]", error.message);
      return NextResponse.json({ error: "Failed to review invoice" }, { status: 500 });
    }
    if (!data) return conflictResponse();

    await writeAudit(admin, ctx, {
      clientId: id,
      action: input.approve ? "Aprovou nota fiscal" : "Rejeitou nota fiscal",
      objectType: "commission",
      objectId: commissionId,
    });
    notifyAffiliate(admin, req, {
      clientId: id,
      affiliateId: current.affiliate_id,
      event: input.approve
        ? { kind: "invoice_approved", period: current.period }
        : { kind: "invoice_rejected", period: current.period, reason: input.reason ?? "" },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof BadInput) return NextResponse.json({ error: err.message }, { status: 400 });
    return toErrorResponse(err);
  }
}
