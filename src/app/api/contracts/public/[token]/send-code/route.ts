// ============================================================
// POST /api/contracts/public/[token]/send-code
//
// Public — no auth. The client clicks "Confirmar e assinar" on the
// review page; this generates a 6-digit OTP, emails it, and only then
// persists it — a failed send never leaves a valid-but-undelivered
// code sitting in the row. Tightly rate-limited per IP since every
// success sends a real email (see RATE_LIMITS.contractSendCode).
// ============================================================

import { NextResponse } from "next/server";
import { hashContractToken } from "@/lib/contracts/tokens";
import { generateOtp } from "@/lib/contracts/otp";
import { sendEmail, isEmailConfigured } from "@/lib/contracts/email";
import { otpCodeEmailHtml } from "@/lib/contracts/email-templates";
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
  const limit = checkRateLimit(`contract-send-code:${ip}`, RATE_LIMITS.contractSendCode);
  if (!limit.success) return rateLimitResponse(limit);

  if (!isEmailConfigured()) {
    return NextResponse.json(
      { error: "O envio de e-mail ainda não está configurado neste ambiente." },
      { status: 503 },
    );
  }

  const { token } = await params;
  if (!token) {
    return NextResponse.json({ error: "Link inválido" }, { status: 400 });
  }

  const admin = supabaseAdmin();
  const tokenHash = hashContractToken(token);

  const { data: contract } = await admin
    .from("deal_contracts")
    .select("id, account_id, client_email, razao_social, status, expires_at")
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

  const otp = generateOtp();

  try {
    await sendEmail({
      to: contract.client_email,
      subject: "Código de confirmação — Aureon",
      text: `Seu código de confirmação é: ${otp.code}\n\nEste código expira em 10 minutos.`,
      html: otpCodeEmailHtml({ code: otp.code, contractTitle: contract.razao_social }),
    });
  } catch (err) {
    console.error("[contracts/send-code] email error:", err);
    return NextResponse.json({ error: "Não foi possível enviar o e-mail. Tente novamente em instantes." }, { status: 502 });
  }

  await admin
    .from("deal_contracts")
    .update({
      otp_code_hash: otp.hash,
      otp_expires_at: otp.expiresAt.toISOString(),
      otp_attempts: 0,
      otp_sent_at: new Date().toISOString(),
    })
    .eq("id", contract.id);

  void admin
    .from("deal_contract_events")
    .insert({ contract_id: contract.id, account_id: contract.account_id, event_type: "sent", metadata: { via: "otp_email" } });

  return NextResponse.json({ ok: true });
}
