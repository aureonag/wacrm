// ============================================================
// GET /api/contracts/public/[token]/peek
//
// Public — no auth. The /contracts/<token> page calls this to render
// the contract for review before the client accepts. Mirrors the shape
// of /api/invitations/[token]/peek (uniform {ok, reason?} envelope,
// rate-limited by IP), but uses the service-role client directly
// instead of a SECURITY DEFINER RPC — the logic here (status
// transitions on read, no cross-table writes) doesn't need the
// transactional guarantees that justified an RPC for invitations.
//
// Side effects (best-effort, never block the response):
//   - A 'sent' contract past its `expires_at` flips to 'expired'.
//   - A 'sent' contract being viewed for the first time flips to
//     'viewed' (status alone; the deal_contract_events row records it).
// ============================================================

import { NextResponse } from "next/server";
import { hashContractToken } from "@/lib/contracts/tokens";
import { maskEmail } from "@/lib/contracts/otp";
import { supabaseAdmin } from "@/lib/contracts/admin-client";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

function getClientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const xri = request.headers.get("x-real-ip");
  if (xri) return xri.trim();
  return "unknown";
}

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const ip = getClientIp(request);
  const limit = checkRateLimit(`contract-peek:${ip}`, RATE_LIMITS.contractPeek);
  if (!limit.success) return rateLimitResponse(limit);

  const { token } = await params;
  if (!token) {
    return NextResponse.json({ ok: false, reason: "not_found" });
  }

  const admin = supabaseAdmin();
  const tokenHash = hashContractToken(token);

  const { data: contract } = await admin
    .from("deal_contracts")
    .select("*")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (!contract) {
    return NextResponse.json({ ok: false, reason: "not_found" });
  }

  let status: string = contract.status;

  if (status === "sent" && contract.expires_at && new Date(contract.expires_at) <= new Date()) {
    status = "expired";
    await admin.from("deal_contracts").update({ status: "expired" }).eq("id", contract.id).eq("status", "sent");
    void admin
      .from("deal_contract_events")
      .insert({ contract_id: contract.id, account_id: contract.account_id, event_type: "expired" });
  } else if (status === "sent") {
    status = "viewed";
    await admin.from("deal_contracts").update({ status: "viewed" }).eq("id", contract.id).eq("status", "sent");
    void admin
      .from("deal_contract_events")
      .insert({ contract_id: contract.id, account_id: contract.account_id, event_type: "viewed" });
  }

  return NextResponse.json({
    ok: true,
    status,
    ref_code: contract.id.slice(0, 8).toUpperCase(),
    razao_social: contract.razao_social,
    cnpj: contract.cnpj,
    endereco: contract.endereco,
    nome_representante: contract.nome_representante,
    cpf_representante: contract.cpf_representante,
    rendered_content: contract.rendered_content,
    client_email_masked: maskEmail(contract.client_email),
    signed_at: contract.signed_at,
  });
}
