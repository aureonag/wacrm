// ============================================================
// POST /api/contracts/[id]/terminate (agent+)
//
// Cancels a SIGNED contract (the older /cancel route only handles
// drafts and unsigned ones). In order:
//   1. terminate_signed_contract (migration 088) records the
//      cancellation and moves the deal's Financeiro clients to
//      "Encerrados" — one transaction, done with the caller's session;
//   2. the cancellation minuta goes by email to the client, with a copy
//      to the account owners and to whoever cancelled it;
//   3. the email outcome is logged on the contract timeline.
// The database change comes first on purpose: if the email fails the
// cancellation still stands and the person is told to warn the client.
// The caller must also type "SIM" (checked here, not only in the UI).
// ============================================================

import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/contracts/admin-client";
import { extractScopeSections } from "@/lib/contracts/scope";
import { sendEmail } from "@/lib/contracts/email";
import {
  NOTICE_DAYS,
  addDaysIso,
  terminationEmailHtml,
  terminationEmailSubject,
  terminationEmailText,
} from "@/lib/contracts/email-templates";
import { parseIsoDate } from "@/lib/finance/closing";

const MAX_NOTE = 1000;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { supabase, accountId, userId } = await requireRole("agent");
    const { id } = await params;

    const body = (await request.json().catch(() => null)) as {
      effectiveDate?: unknown;
      note?: unknown;
      confirm?: unknown;
    } | null;

    const effectiveDate = typeof body?.effectiveDate === "string" ? body.effectiveDate : "";
    const note = typeof body?.note === "string" ? body.note.trim().slice(0, MAX_NOTE) : "";
    const confirm = typeof body?.confirm === "string" ? body.confirm.trim().toLowerCase() : "";

    if (confirm !== "sim") {
      return NextResponse.json({ error: 'Digite "SIM" para confirmar o cancelamento.' }, { status: 400 });
    }
    if (!parseIsoDate(effectiveDate)) {
      return NextResponse.json({ error: "Informe a data em que o cancelamento passa a valer." }, { status: 400 });
    }

    const { data: contract } = await supabase
      .from("deal_contracts")
      .select("id, status, terminated_at, razao_social, cnpj, nome_representante, client_email, signed_at, rendered_content")
      .eq("id", id)
      .eq("account_id", accountId)
      .maybeSingle();
    if (!contract) return NextResponse.json({ error: "Contrato não encontrado." }, { status: 404 });
    if (contract.status !== "signed") {
      return NextResponse.json({ error: "Só é possível cancelar um contrato já assinado." }, { status: 409 });
    }
    if (contract.terminated_at) {
      return NextResponse.json({ error: "Este contrato já foi cancelado." }, { status: 409 });
    }

    const { data: result, error } = await supabase.rpc("terminate_signed_contract", {
      p_contract_id: id,
      p_effective_date: addDaysIso(effectiveDate, NOTICE_DAYS), // término = cancelamento + aviso prévio
      p_note: note,
    });
    if (error) {
      console.error("[contracts/terminate] rpc error:", error);
      const message = /before signature/.test(error.message)
        ? "A data do cancelamento não pode ser anterior à assinatura do contrato."
        : /already terminated/.test(error.message)
          ? "Este contrato já foi cancelado."
          : "Não foi possível cancelar o contrato.";
      const status = /forbidden/.test(error.message) ? 403 : /already|not signed|before signature/.test(error.message) ? 409 : 500;
      return NextResponse.json({ error: message }, { status });
    }

    // ---- minuta by email ------------------------------------------------
    const admin = supabaseAdmin();
    const serviceLines = (extractScopeSections(contract.rendered_content as string | null).find((s) => s.key === "service")
      ?.lines ?? []).map((l) => l.replace(/^[-*•]\s+/, ""));
    const args = {
      razaoSocial: contract.razao_social as string,
      cnpj: contract.cnpj as string,
      representante: contract.nome_representante as string,
      signedAt: (contract.signed_at as string | null) ?? null,
      serviceLines,
      effectiveDate,
      note: note || null,
      contractRef: id.slice(0, 8),
    };

    const { data: owners } = await admin
      .from("profiles")
      .select("email")
      .eq("account_id", accountId)
      .eq("account_role", "owner");
    const { data: actor } = await admin.from("profiles").select("email").eq("user_id", userId).maybeSingle();
    const to = (contract.client_email as string).trim();
    const cc = [...new Set([...(owners ?? []).map((o) => o.email as string), (actor?.email as string | undefined) ?? ""])]
      .filter((e) => e && e.toLowerCase() !== to.toLowerCase());

    let emailSent = false;
    try {
      await sendEmail({
        to,
        cc,
        subject: terminationEmailSubject(args.razaoSocial),
        text: terminationEmailText(args),
        html: terminationEmailHtml(args),
      });
      emailSent = true;
    } catch (err) {
      console.error("[contracts/terminate] email error:", err);
    }

    await admin.from("deal_contract_events").insert({
      contract_id: id,
      account_id: accountId,
      event_type: emailSent ? "termination_email_sent" : "termination_email_failed",
      actor_user_id: userId,
      metadata: { to, cc },
    });

    return NextResponse.json({
      ok: true,
      emailSent,
      endedClients: (result as { ended_clients?: number } | null)?.ended_clients ?? 0,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
