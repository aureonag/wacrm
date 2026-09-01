// ============================================================
// POST /api/contracts/[id]/send (agent+)
//
// Renders the template snapshot and moves a draft contract to 'sent'.
//
//   - signing_method='virtual': generates the acceptance-link token,
//     returns the link for the agent to copy/WhatsApp/email manually.
//     No email is sent here — the OTP email only goes out when the
//     client actually opens the link and asks to confirm (see
//     /api/contracts/public/[token]/send-code).
//   - signing_method='clicksign': not implemented yet (M4) — returns
//     501 so the UI can show a clear "coming soon" message instead of
//     a confusing generic failure.
// ============================================================

import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { renderTemplate } from "@/lib/contracts/templating";
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
      .select("*, template:contract_templates(content)")
      .eq("id", id)
      .eq("account_id", accountId)
      .maybeSingle();

    if (!contract) {
      return NextResponse.json({ error: "Contract not found" }, { status: 404 });
    }
    if (contract.status !== "draft") {
      return NextResponse.json({ error: "Contract has already been sent" }, { status: 400 });
    }

    const templateContent = (contract.template as { content?: string } | null)?.content;
    if (!templateContent) {
      return NextResponse.json({ error: "Contract has no template content" }, { status: 400 });
    }

    const renderedContent = renderTemplate(templateContent, {
      razao_social_cliente: contract.razao_social,
      cnpj_cliente: contract.cnpj,
      endereco_cliente: contract.endereco,
      nome_representante_cliente: contract.nome_representante,
      cpf_representante_cliente: contract.cpf_representante,
    });

    if (contract.signing_method === "clicksign") {
      return NextResponse.json(
        { error: "A assinatura via Clicksign ainda não está disponível — use o aceite virtual por enquanto." },
        { status: 501 },
      );
    }

    // signing_method === 'virtual'
    const { token, hash } = generateContractToken();
    const expiresAt = contractExpiresAt();

    const { error: updateError } = await supabase
      .from("deal_contracts")
      .update({
        rendered_content: renderedContent,
        token_hash: hash,
        status: "sent",
        sent_at: new Date().toISOString(),
        expires_at: expiresAt.toISOString(),
      })
      .eq("id", contract.id);

    if (updateError) {
      console.error("[contracts/send] update error:", updateError);
      return NextResponse.json({ error: "Failed to send contract" }, { status: 500 });
    }

    await supabase.from("deal_contract_events").insert({
      contract_id: contract.id,
      account_id: accountId,
      event_type: "sent",
      actor_user_id: userId,
    });

    return NextResponse.json({ link: contractSignUrl(token, getBaseUrl(request)) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
