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
//
// After the status update succeeds, `after()` (next/server) generates
// the signed PDF, stores it in the `contracts` bucket
// (signed_pdf_path), and emails a copy to the client and to the
// deal's responsible salesperson (Allan, 2026-09-30) — all best-effort
// and never blocking the client's "signed!" response. Wrapped in
// after() rather than a bare unawaited promise: a fire-and-forget
// insert on this exact route (the 'signed' event below) was already
// found to silently never complete in production before — see the
// 2026-09-29 note on /api/contracts/public/[token]/peek.
// ============================================================

import { NextResponse } from "next/server";
import { after } from "next/server";
import { hashContractToken } from "@/lib/contracts/tokens";
import { hashOtp, OTP_MAX_ATTEMPTS } from "@/lib/contracts/otp";
import { supabaseAdmin } from "@/lib/contracts/admin-client";
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from "@/lib/rate-limit";
import { ensureSignedContractPdf } from "@/lib/contracts/signed-pdf-storage";
import { syncSignedContractClients } from "@/lib/operational/sync-contract-clients";
import { sendEmail, isEmailConfigured } from "@/lib/contracts/email";
import {
  signedContractEmailSubject,
  signedContractClientEmailText,
  signedContractClientEmailHtml,
  signedContractSalespersonEmailText,
  signedContractSalespersonEmailHtml,
} from "@/lib/contracts/email-templates";

function getClientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const xri = request.headers.get("x-real-ip");
  if (xri) return xri.trim();
  return "unknown";
}

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
  const signedAt = new Date().toISOString();
  const { error: updateError } = await admin
    .from("deal_contracts")
    .update({
      status: "signed",
      signed_at: signedAt,
      signed_ip: ip,
      signed_user_agent: userAgent,
    })
    .eq("id", contract.id);

  if (updateError) {
    console.error("[contracts/verify-and-accept] update error:", updateError);
    return NextResponse.json({ error: "Não foi possível confirmar o aceite. Tente novamente." }, { status: 500 });
  }

  const baseUrl = getBaseUrl(request);

  after(async () => {
    const { error: eventError } = await admin
      .from("deal_contract_events")
      .insert({ contract_id: contract.id, account_id: contract.account_id, event_type: "signed" });
    if (eventError) console.error("[contracts/verify-and-accept] failed to log 'signed' event:", eventError.message);

    // A signed contract is a client of the operation (Operacional → Clientes).
    try {
      await syncSignedContractClients(admin, contract.account_id, contract.id);
    } catch (err) {
      console.error("[contracts/verify-and-accept] client sync failed:", err);
    }

    const { data: full } = await admin
      .from("deal_contracts")
      .select("deal_id, razao_social, cnpj, endereco, nome_representante, cpf_representante, client_email, rendered_content")
      .eq("id", contract.id)
      .maybeSingle();
    if (!full || !full.rendered_content) {
      console.error("[contracts/verify-and-accept] missing contract data, skipping PDF/email");
      return;
    }

    const refCode = contract.id.slice(0, 8).toUpperCase();
    let pdfBuffer: Buffer;
    try {
      const pdf = await ensureSignedContractPdf(admin, contract.id);
      if (!pdf) {
        console.error("[contracts/verify-and-accept] ensureSignedContractPdf returned null right after signing");
        return;
      }
      pdfBuffer = pdf.buffer;
    } catch (err) {
      console.error("[contracts/verify-and-accept] PDF generation/upload failed:", err);
      return;
    }

    if (!isEmailConfigured()) {
      console.error("[contracts/verify-and-accept] email not configured, skipping signed-contract emails");
      return;
    }

    const emailArgs = {
      razaoSocial: full.razao_social,
      cnpj: full.cnpj,
      representante: full.nome_representante,
      signedAt,
      contractRef: refCode,
    };
    const attachments = [
      { filename: `contrato-assinado-${refCode}.pdf`, content: pdfBuffer, contentType: "application/pdf" },
    ];

    try {
      await sendEmail({
        to: full.client_email,
        subject: signedContractEmailSubject(full.razao_social),
        text: signedContractClientEmailText(emailArgs),
        html: signedContractClientEmailHtml(emailArgs),
        attachments,
      });
    } catch (err) {
      console.error("[contracts/verify-and-accept] client email failed:", err);
    }

    const { data: deal } = await admin.from("deals").select("assigned_to").eq("id", full.deal_id).maybeSingle();
    const assigneeId = deal?.assigned_to;
    if (assigneeId) {
      const { data: assignee } = await admin.from("profiles").select("email").eq("id", assigneeId).maybeSingle();
      if (assignee?.email) {
        const dealUrl = `${baseUrl}/pipelines/deals/${full.deal_id}`;
        try {
          await sendEmail({
            to: assignee.email,
            subject: signedContractEmailSubject(full.razao_social),
            text: signedContractSalespersonEmailText({ ...emailArgs, dealUrl }),
            html: signedContractSalespersonEmailHtml({ ...emailArgs, dealUrl }),
            attachments,
          });
        } catch (err) {
          console.error("[contracts/verify-and-accept] salesperson email failed:", err);
        }
      }
    }
  });

  return NextResponse.json({ ok: true });
}
