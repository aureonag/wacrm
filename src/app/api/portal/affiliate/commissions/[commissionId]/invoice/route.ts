// POST /api/portal/affiliate/commissions/:commissionId/invoice
//   multipart: number, issuer, recipient, value_cents, file (PDF/PNG/JPEG ≤ 5 MB)
//
// The affiliate sends the nota fiscal of THEIR OWN commission (from
// awaiting_invoice or invoice_rejected). Someone else's commission = 404.

import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/auth/account";
import { BadInput, isUuid } from "@/lib/affiliates/campaigns";
import { parseInvoiceFields } from "@/lib/affiliates/commissions";
import { StorageNotReady, storageNotReadyResponse } from "@/lib/affiliates/commissions-server";
import { readUpload } from "@/lib/affiliates/documents";
import { submitInvoice } from "@/lib/affiliates/invoices-server";
import { requireAffiliate, writeAffiliateAudit } from "@/lib/affiliates/portal";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

export async function POST(req: Request, { params }: { params: Promise<{ commissionId: string }> }) {
  try {
    const ctx = await requireAffiliate();
    const limit = checkRateLimit(`aff-portal-write:${ctx.userId}`, RATE_LIMITS.affiliatePortalWrite);
    if (!limit.success) return rateLimitResponse(limit);

    const { commissionId } = await params;
    if (!isUuid(commissionId)) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Resolve the commission's client from the affiliate's OWN row.
    const own = await ctx.admin
      .from("aff_commissions")
      .select("client_id")
      .eq("id", commissionId)
      .eq("affiliate_id", ctx.affiliate.id)
      .maybeSingle();
    if (own.error) return NextResponse.json({ error: "Failed to save invoice" }, { status: 500 });
    if (!own.data) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const form = await req.formData().catch(() => null);
    if (!form) return NextResponse.json({ error: "Solicitação inválida." }, { status: 400 });
    const fields = parseInvoiceFields((k) => form.get(k));
    const doc = await readUpload(form.get("file"));

    const failure = await submitInvoice(ctx.admin, {
      clientId: own.data.client_id,
      commissionId,
      onlyAffiliateId: ctx.affiliate.id,
      fields,
      doc,
    });
    if (failure) return failure;

    await writeAffiliateAudit(ctx.admin, ctx, {
      clientId: own.data.client_id,
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
