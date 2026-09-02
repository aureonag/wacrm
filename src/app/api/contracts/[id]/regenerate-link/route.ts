// ============================================================
// POST /api/contracts/[id]/regenerate-link (agent+)
//
// Issues a fresh acceptance-link token for a virtual contract that's
// already been sent — the plaintext token is never persisted (only its
// hash, same as /send and invitations.ts), so once the agent's copy of
// the original link is gone there's no way to recover it. This gives
// them a new one instead: same rendered_content and legal fields,
// new token_hash + expires_at, old link stops working. Also the way
// to "resend" an expired link without cancelling and starting a new
// contract from scratch.
// ============================================================

import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { generateContractToken, contractSignUrl, contractExpiresAt } from "@/lib/contracts/tokens";

function getBaseUrl(request: Request): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (forwardedHost) return `${forwardedProto || "https"}://${forwardedHost}`;
  const host = request.headers.get("host");
  if (host) return `${request.headers.get("x-forwarded-proto") || "https"}://${host}`;
  return "http://localhost:3000";
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId, userId } = await requireRole("agent");
    const { id } = await params;

    const { data: contract } = await supabase
      .from("deal_contracts")
      .select("id, signing_method, status")
      .eq("id", id)
      .eq("account_id", accountId)
      .maybeSingle();

    if (!contract) {
      return NextResponse.json({ error: "Contract not found" }, { status: 404 });
    }
    if (contract.signing_method !== "virtual") {
      return NextResponse.json({ error: "Only virtual-acceptance contracts have a link" }, { status: 400 });
    }
    if (!["sent", "viewed", "expired"].includes(contract.status)) {
      return NextResponse.json({ error: "This contract's link can no longer be regenerated" }, { status: 400 });
    }

    const { token, hash } = generateContractToken();
    const expiresAt = contractExpiresAt();

    const { error: updateError } = await supabase
      .from("deal_contracts")
      .update({ token_hash: hash, status: "sent", expires_at: expiresAt.toISOString() })
      .eq("id", contract.id);

    if (updateError) {
      console.error("[contracts/regenerate-link] update error:", updateError);
      return NextResponse.json({ error: "Failed to regenerate link" }, { status: 500 });
    }

    await supabase.from("deal_contract_events").insert({
      contract_id: contract.id,
      account_id: accountId,
      event_type: "sent",
      actor_user_id: userId,
      metadata: { regenerated: true },
    });

    return NextResponse.json({ link: contractSignUrl(token, getBaseUrl(request)) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
