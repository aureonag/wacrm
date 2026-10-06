// POST /api/operational/affiliates/clients/:id/commissions/:commissionId/payment
//   multipart: reference, file (comprovante PDF/PNG/JPEG ≤ 5 MB)
//
// Records a payment ALREADY made outside the platform (Pix/transferência),
// with its receipt. This does not move money. Only from `available` (nota
// aprovada) — the database also enforces it with a CHECK.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { BadInput, requireClientAccess, writeAudit } from "@/lib/affiliates/admin";
import { isUuid } from "@/lib/affiliates/campaigns";
import { parsePaymentReference } from "@/lib/affiliates/commissions";
import {
  conflictResponse,
  loadCommissionFiles,
  StorageNotReady,
  storageNotReadyResponse,
} from "@/lib/affiliates/commissions-server";
import { readUpload, removeDoc, storeDoc } from "@/lib/affiliates/documents";
import { notifyAffiliate } from "@/lib/affiliates/notifications";

export async function POST(req: Request, { params }: { params: Promise<{ id: string; commissionId: string }> }) {
  try {
    const { id, commissionId } = await params;
    if (!isUuid(id) || !isUuid(commissionId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { ctx, admin } = await requireClientAccess(id, [["payments", "edit"]]);

    const form = await req.formData().catch(() => null);
    if (!form) return NextResponse.json({ error: "Solicitação inválida." }, { status: 400 });
    const reference = parsePaymentReference(form.get("reference"));
    const doc = await readUpload(form.get("file"));

    const current = await loadCommissionFiles(admin, id, commissionId);
    if (current instanceof NextResponse) return current;
    if (current.status !== "available") {
      return NextResponse.json({ error: "O pagamento só pode ser registrado com a nota aprovada." }, { status: 409 });
    }

    const path = await storeDoc(admin, id, commissionId, "receipt", doc);
    const { data, error } = await admin
      .from("aff_commissions")
      .update({
        status: "paid_external",
        payment_reference: reference,
        paid_at: new Date().toISOString(),
        paid_by: ctx.userId,
        receipt_file_path: path,
        receipt_file_name: doc.name,
        receipt_file_mime: doc.mime,
      })
      .eq("id", commissionId)
      .eq("client_id", id)
      .eq("status", "available")
      .select("id, gross_cents, withholding_cents")
      .maybeSingle();
    if (error || !data) {
      await removeDoc(admin, path);
      if (error) {
        console.error("[POST affiliates/commissions/payment]", error.message);
        return NextResponse.json({ error: "Failed to register payment" }, { status: 500 });
      }
      return conflictResponse();
    }

    await writeAudit(admin, ctx, {
      clientId: id,
      action: "Registrou pagamento externo",
      objectType: "commission",
      objectId: commissionId,
    });
    const net = (Number(data.gross_cents) - Number(data.withholding_cents)) / 100;
    notifyAffiliate(admin, req, {
      clientId: id,
      affiliateId: current.affiliate_id,
      event: {
        kind: "payment_registered",
        period: current.period,
        net: new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(net),
      },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof BadInput) return NextResponse.json({ error: err.message }, { status: 400 });
    if (err instanceof StorageNotReady) return storageNotReadyResponse();
    return toErrorResponse(err);
  }
}
