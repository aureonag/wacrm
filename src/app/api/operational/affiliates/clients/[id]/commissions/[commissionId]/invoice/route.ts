// POST /api/operational/affiliates/clients/:id/commissions/:commissionId/invoice
//   multipart: number, issuer, recipient, value_cents, file (PDF/PNG/JPEG ≤ 5 MB)
//
// Registers the nota fiscal and sends it to review. Allowed from
// awaiting_invoice or invoice_rejected (reenvio). The staff user sends it on
// behalf of the affiliate (the affiliate can also send it from the portal).

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { BadInput, requireStaff, writeAudit } from "@/lib/affiliates/admin";
import { isUuid } from "@/lib/affiliates/campaigns";
import { parseInvoiceFields } from "@/lib/affiliates/commissions";
import { StorageNotReady, storageNotReadyResponse } from "@/lib/affiliates/commissions-server";
import { readUpload } from "@/lib/affiliates/documents";
import { submitInvoice } from "@/lib/affiliates/invoices-server";

export async function POST(req: Request, { params }: { params: Promise<{ id: string; commissionId: string }> }) {
  try {
    const { ctx, admin } = await requireStaff();
    const { id, commissionId } = await params;
    if (!isUuid(id) || !isUuid(commissionId)) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const form = await req.formData().catch(() => null);
    if (!form) return NextResponse.json({ error: "Solicitação inválida." }, { status: 400 });
    const fields = parseInvoiceFields((k) => form.get(k));
    const doc = await readUpload(form.get("file"));

    const failure = await submitInvoice(admin, { clientId: id, commissionId, fields, doc });
    if (failure) return failure;

    await writeAudit(admin, ctx, {
      clientId: id,
      action: "Enviou nota fiscal",
      objectType: "commission",
      objectId: commissionId,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof BadInput) return NextResponse.json({ error: err.message }, { status: 400 });
    if (err instanceof StorageNotReady) return storageNotReadyResponse();
    return toErrorResponse(err);
  }
}
