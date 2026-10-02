// POST /api/operational/affiliates/clients/:id/commissions/:commissionId/invoice
//   multipart: number, issuer, recipient, value_cents, file (PDF/PNG/JPEG ≤ 5 MB)
//
// Registers the nota fiscal and sends it to review. Allowed from
// awaiting_invoice or invoice_rejected (reenvio). The staff user sends it on
// behalf of the affiliate until the affiliate portal exists.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { BadInput, requireStaff, writeAudit } from "@/lib/affiliates/admin";
import { isUuid } from "@/lib/affiliates/campaigns";
import { parseInvoiceFields } from "@/lib/affiliates/commissions";
import {
  conflictResponse,
  loadCommissionFiles,
  StorageNotReady,
  storageNotReadyResponse,
} from "@/lib/affiliates/commissions-server";
import { readUpload, removeDoc, storeDoc } from "@/lib/affiliates/documents";

export async function POST(req: Request, { params }: { params: Promise<{ id: string; commissionId: string }> }) {
  try {
    const { ctx, admin } = await requireStaff();
    const { id, commissionId } = await params;
    if (!isUuid(id) || !isUuid(commissionId)) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const form = await req.formData().catch(() => null);
    if (!form) return NextResponse.json({ error: "Solicitação inválida." }, { status: 400 });
    const fields = parseInvoiceFields((k) => form.get(k));
    const doc = await readUpload(form.get("file"));

    const current = await loadCommissionFiles(admin, id, commissionId);
    if (current instanceof NextResponse) return current;
    if (current.status !== "awaiting_invoice" && current.status !== "invoice_rejected") {
      return NextResponse.json({ error: "Esta comissão não aceita o envio de nota agora." }, { status: 409 });
    }

    const path = await storeDoc(admin, id, commissionId, "invoice", doc);
    const { data, error } = await admin
      .from("aff_commissions")
      .update({
        status: "invoice_review",
        invoice_number: fields.number,
        invoice_issuer: fields.issuer,
        invoice_recipient: fields.recipient,
        invoice_value_cents: fields.value_cents,
        invoice_status: "in_review",
        invoice_reason: null,
        invoice_sent_at: new Date().toISOString(),
        invoice_file_path: path,
        invoice_file_name: doc.name,
        invoice_file_mime: doc.mime,
      })
      .eq("id", commissionId)
      .eq("client_id", id)
      .eq("status", current.status)
      .select("id")
      .maybeSingle();
    if (error || !data) {
      await removeDoc(admin, path);
      if (error) {
        console.error("[POST affiliates/commissions/invoice]", error.message);
        return NextResponse.json({ error: "Failed to save invoice" }, { status: 500 });
      }
      return conflictResponse();
    }

    await removeDoc(admin, current.invoice_file_path);
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
