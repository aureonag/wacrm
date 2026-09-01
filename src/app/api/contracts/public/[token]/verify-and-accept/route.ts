// ============================================================
// POST /api/contracts/public/[token]/verify-and-accept
//
// Public — no auth. Checks the OTP code the client typed against the
// hash stored by /send-code; on match, marks the contract 'signed'
// with the acceptance metadata (ip/timestamp/user agent). That single
// UPDATE is what fires the `handle_contract_signed` trigger (migration
// 054) — moving the deal to "Contrato fechado", marking it Ganho, and
// notifying the owner — same as the Clicksign webhook will do in M4,
// with zero duplicated logic between the two paths.
// ============================================================

import { NextResponse } from "next/server";
import { hashContractToken } from "@/lib/contracts/tokens";
import { hashOtp, OTP_MAX_ATTEMPTS } from "@/lib/contracts/otp";
import { supabaseAdmin } from "@/lib/contracts/admin-client";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";

function getClientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const xri = request.headers.get("x-real-ip");
  if (xri) return xri.trim();
  return "unknown";
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const ip = getClientIp(request);
  const limit = checkRateLimit(`contract-verify:${ip}`, RATE_LIMITS.contractVerifyCode);
  if (!limit.success) return rateLimitResponse(limit);

  const { token } = await params;
  const body = (await request.json().catch(() => null)) as { code?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code.trim() : "";

  if (!token || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ error: "Código inválido" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const tokenHash = hashContractToken(token);

  const { data: contract } = await admin
    .from("deal_contracts")
    .select("id, account_id, status, otp_code_hash, otp_expires_at, otp_attempts, expires_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (!contract) {
    return NextResponse.json({ error: "Link inválido" }, { status: 404 });
  }
  if (contract.status !== "sent" && contract.status !== "viewed") {
    return NextResponse.json({ error: "Este contrato não está mais disponível para assinatura." }, { status: 400 });
  }
  if (contract.expires_at && new Date(contract.expires_at) <= new Date()) {
    return NextResponse.json({ error: "Este link expirou." }, { status: 400 });
  }
  if (!contract.otp_code_hash || !contract.otp_expires_at) {
    return NextResponse.json({ error: "Peça um novo código antes de confirmar." }, { status: 400 });
  }
  if (contract.otp_attempts >= OTP_MAX_ATTEMPTS) {
    return NextResponse.json({ error: "Muitas tentativas. Peça um novo código." }, { status: 400 });
  }
  if (new Date(contract.otp_expires_at) <= new Date()) {
    return NextResponse.json({ error: "Esse código expirou. Peça um novo." }, { status: 400 });
  }

  if (hashOtp(code) !== contract.otp_code_hash) {
    const attempts = contract.otp_attempts + 1;
    await admin.from("deal_contracts").update({ otp_attempts: attempts }).eq("id", contract.id);
    const remaining = OTP_MAX_ATTEMPTS - attempts;
    return NextResponse.json(
      {
        error:
          remaining > 0
            ? `Código incorreto. ${remaining} tentativa(s) restante(s).`
            : "Código incorreto. Peça um novo código.",
      },
      { status: 400 },
    );
  }

  const userAgent = request.headers.get("user-agent") || null;
  const { error: updateError } = await admin
    .from("deal_contracts")
    .update({
      status: "signed",
      signed_at: new Date().toISOString(),
      signed_ip: ip,
      signed_user_agent: userAgent,
    })
    .eq("id", contract.id);

  if (updateError) {
    console.error("[contracts/verify-and-accept] update error:", updateError);
    return NextResponse.json({ error: "Não foi possível confirmar o aceite. Tente novamente." }, { status: 500 });
  }

  void admin
    .from("deal_contract_events")
    .insert({ contract_id: contract.id, account_id: contract.account_id, event_type: "signed" });

  return NextResponse.json({ ok: true });
}
