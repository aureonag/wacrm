// ============================================================
// POST /api/contracts/[id]/cancel (agent+)
//
// Marks a contract cancelled — a status update, never a delete, so
// the timeline and any already-collected data survive. Refuses once a
// contract is already signed (nothing to cancel at that point).
// ============================================================

import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId, userId } = await requireRole("agent");
    const { id } = await params;

    const { data: contract } = await supabase
      .from("deal_contracts")
      .select("id, status")
      .eq("id", id)
      .eq("account_id", accountId)
      .maybeSingle();

    if (!contract) {
      return NextResponse.json({ error: "Contract not found" }, { status: 404 });
    }
    if (contract.status === "signed") {
      return NextResponse.json({ error: "A signed contract cannot be cancelled" }, { status: 400 });
    }
    if (contract.status === "cancelled") {
      return NextResponse.json({ ok: true });
    }

    const { error } = await supabase
      .from("deal_contracts")
      .update({ status: "cancelled" })
      .eq("id", contract.id);

    if (error) {
      console.error("[contracts/cancel] update error:", error);
      return NextResponse.json({ error: "Failed to cancel contract" }, { status: 500 });
    }

    await supabase.from("deal_contract_events").insert({
      contract_id: contract.id,
      account_id: accountId,
      event_type: "cancelled",
      actor_user_id: userId,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
