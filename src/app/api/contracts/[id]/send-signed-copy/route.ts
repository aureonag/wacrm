// ============================================================
// POST /api/contracts/[id]/send-signed-copy (agent+)
//
// Emails a copy of the signed contract's PDF. Defaults to the
// client's registered email (`deal_contracts.client_email`) — an
// optional `email` in the body overrides it, for resending to a
// different address (Allan, 2026-09-30). Generates the PDF on demand
// via ensureSignedContractPdf if it wasn't already stored.
// ============================================================

import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { ensureSignedContractPdf } from "@/lib/contracts/signed-pdf-storage";
import { sendEmail, isEmailConfigured } from "@/lib/contracts/email";
import {
  signedContractEmailSubject,
  signedContractClientEmailText,
  signedContractClientEmailHtml,
} from "@/lib/contracts/email-templates";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId } = await requireRole("agent");
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as { email?: unknown } | null;
    const overrideEmail = typeof body?.email === "string" ? body.email.trim() : "";
    if (overrideEmail && !EMAIL_RE.test(overrideEmail)) {
      return NextResponse.json({ error: "E-mail inválido" }, { status: 400 });
    }

    const { data: contract } = await supabase
      .from("deal_contracts")
      .select("id, razao_social, cnpj, nome_representante, client_email, signed_at")
      .eq("id", id)
      .eq("account_id", accountId)
      .maybeSingle();
    if (!contract) {
      return NextResponse.json({ error: "Contract not found" }, { status: 404 });
    }

    if (!isEmailConfigured()) {
      return NextResponse.json({ error: "Envio de e-mail não está configurado" }, { status: 503 });
    }

    const pdf = await ensureSignedContractPdf(supabase, id);
    if (!pdf || !contract.signed_at) {
      return NextResponse.json({ error: "Este contrato ainda não foi assinado" }, { status: 400 });
    }

    const to = overrideEmail || contract.client_email;
    const refCode = contract.id.slice(0, 8).toUpperCase();
    const emailArgs = {
      razaoSocial: contract.razao_social,
      cnpj: contract.cnpj,
      representante: contract.nome_representante,
      signedAt: contract.signed_at,
      contractRef: refCode,
    };

    try {
      await sendEmail({
        to,
        subject: signedContractEmailSubject(contract.razao_social),
        text: signedContractClientEmailText(emailArgs),
        html: signedContractClientEmailHtml(emailArgs),
        attachments: [
          { filename: `contrato-assinado-${refCode}.pdf`, content: pdf.buffer, contentType: "application/pdf" },
        ],
      });
    } catch (err) {
      console.error("[contracts/send-signed-copy] email error:", err);
      return NextResponse.json({ error: "Não foi possível enviar o e-mail. Tente novamente em instantes." }, { status: 502 });
    }

    return NextResponse.json({ ok: true, to });
  } catch (err) {
    return toErrorResponse(err);
  }
}
