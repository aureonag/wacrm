// GET /api/operational/affiliates/clients/:id/commissions/:commissionId/file?kind=invoice|receipt
//   → { url } short-lived signed URL (60 s) for the nota fiscal / comprovante.
//
// Access to fiscal documents is audited. Staff only.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { requireStaff, writeAudit } from "@/lib/affiliates/admin";
import { isUuid } from "@/lib/affiliates/campaigns";
import { loadCommissionFiles } from "@/lib/affiliates/commissions-server";
import { signedDocUrl } from "@/lib/affiliates/documents";

export async function GET(req: Request, { params }: { params: Promise<{ id: string; commissionId: string }> }) {
  try {
    const { ctx, admin } = await requireStaff();
    const { id, commissionId } = await params;
    if (!isUuid(id) || !isUuid(commissionId)) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const kind = new URL(req.url).searchParams.get("kind");
    if (kind !== "invoice" && kind !== "receipt") return NextResponse.json({ error: "Solicitação inválida." }, { status: 400 });

    const current = await loadCommissionFiles(admin, id, commissionId);
    if (current instanceof NextResponse) return current;
    const path = kind === "invoice" ? current.invoice_file_path : current.receipt_file_path;
    const name = kind === "invoice" ? current.invoice_file_name : current.receipt_file_name;
    if (!path) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const url = await signedDocUrl(admin, path, name);
    if (!url) return NextResponse.json({ error: "Failed to create a download link" }, { status: 500 });

    await writeAudit(admin, ctx, {
      clientId: id,
      action: kind === "invoice" ? "Baixou nota fiscal" : "Baixou comprovante",
      objectType: "commission",
      objectId: commissionId,
    });
    return NextResponse.json({ url });
  } catch (err) {
    return toErrorResponse(err);
  }
}
