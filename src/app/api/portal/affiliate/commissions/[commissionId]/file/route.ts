// GET /api/portal/affiliate/commissions/:commissionId/file?kind=invoice|receipt
//   → { url } short-lived signed URL for the affiliate's OWN documents.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { isUuid } from "@/lib/affiliates/campaigns";
import { signedDocUrl } from "@/lib/affiliates/documents";
import { requireAffiliate, writeAffiliateAudit } from "@/lib/affiliates/portal";

export async function GET(req: Request, { params }: { params: Promise<{ commissionId: string }> }) {
  try {
    const ctx = await requireAffiliate();
    const { commissionId } = await params;
    if (!isUuid(commissionId)) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const kind = new URL(req.url).searchParams.get("kind");
    if (kind !== "invoice" && kind !== "receipt") return NextResponse.json({ error: "Solicitação inválida." }, { status: 400 });

    const { data, error } = await ctx.admin
      .from("aff_commissions")
      .select("client_id, invoice_file_path, invoice_file_name, receipt_file_path, receipt_file_name")
      .eq("id", commissionId)
      .eq("affiliate_id", ctx.affiliate.id)
      .maybeSingle();
    if (error) return NextResponse.json({ error: "Failed to create a download link" }, { status: 500 });
    const path = kind === "invoice" ? data?.invoice_file_path : data?.receipt_file_path;
    const name = kind === "invoice" ? data?.invoice_file_name : data?.receipt_file_name;
    if (!data || !path) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const url = await signedDocUrl(ctx.admin, path, name ?? null);
    if (!url) return NextResponse.json({ error: "Failed to create a download link" }, { status: 500 });

    await writeAffiliateAudit(ctx.admin, ctx, {
      clientId: data.client_id,
      action: kind === "invoice" ? "Baixou a própria nota fiscal" : "Baixou o próprio comprovante",
      objectType: "commission",
      objectId: commissionId,
    });
    return NextResponse.json({ url });
  } catch (err) {
    return toErrorResponse(err);
  }
}
