// ============================================================
// POST /api/contracts/[id]/signed-pdf (agent+)
//
// Returns a short-lived signed URL to the contract's signed PDF,
// generating and storing it first if it doesn't exist yet (contracts
// signed before this feature existed). Backs the "Baixar contrato
// assinado" button in the Contrato tab.
// ============================================================

import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { ensureSignedContractPdf } from "@/lib/contracts/signed-pdf-storage";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId } = await requireRole("agent");
    const { id } = await params;

    const { data: contract } = await supabase
      .from("deal_contracts")
      .select("id")
      .eq("id", id)
      .eq("account_id", accountId)
      .maybeSingle();
    if (!contract) {
      return NextResponse.json({ error: "Contract not found" }, { status: 404 });
    }

    let pdf: Awaited<ReturnType<typeof ensureSignedContractPdf>>;
    try {
      pdf = await ensureSignedContractPdf(supabase, id);
    } catch (err) {
      // Say what failed (to the signed-in agent) instead of a bare "Internal
      // server error" — the host keeps no logs of this.
      const detail = err instanceof Error ? err.message : String(err);
      console.error("[contracts/signed-pdf] PDF generation/upload failed:", err);
      return NextResponse.json({ error: "Failed to generate the signed PDF", detail }, { status: 500 });
    }
    if (!pdf) {
      return NextResponse.json({ error: "This contract isn't signed yet" }, { status: 400 });
    }

    const { data: signed, error: signError } = await supabase.storage
      .from("contracts")
      .createSignedUrl(pdf.path, 120);
    if (signError || !signed) {
      console.error("[contracts/signed-pdf] createSignedUrl failed:", signError?.message);
      return NextResponse.json({ error: "Failed to create a download link" }, { status: 500 });
    }

    return NextResponse.json({ url: signed.signedUrl });
  } catch (err) {
    return toErrorResponse(err);
  }
}
