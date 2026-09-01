// ============================================================
// POST /api/contracts (agent+)
//
// Creates a draft `deal_contracts` row — the 6 client-data fields plus
// the picked template and signing method. No email is sent and no
// rendering happens here; that's `/api/contracts/[id]/send`. Splitting
// create from send lets the agent review/edit before anything reaches
// the client.
// ============================================================

import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";

interface CreateContractBody {
  deal_id?: unknown;
  template_id?: unknown;
  razao_social?: unknown;
  cnpj?: unknown;
  endereco?: unknown;
  nome_representante?: unknown;
  cpf_representante?: unknown;
  client_email?: unknown;
  signing_method?: unknown;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await requireRole("agent");
    const body = (await request.json().catch(() => null)) as CreateContractBody | null;

    const dealId = str(body?.deal_id);
    const razaoSocial = str(body?.razao_social);
    const cnpj = str(body?.cnpj);
    const endereco = str(body?.endereco);
    const nomeRepresentante = str(body?.nome_representante);
    const cpfRepresentante = str(body?.cpf_representante);
    const clientEmail = str(body?.client_email);
    const signingMethod = str(body?.signing_method);
    const templateId = str(body?.template_id) || null;

    if (
      !dealId ||
      !razaoSocial ||
      !cnpj ||
      !endereco ||
      !nomeRepresentante ||
      !cpfRepresentante ||
      !clientEmail ||
      (signingMethod !== "clicksign" && signingMethod !== "virtual")
    ) {
      return NextResponse.json({ error: "Missing or invalid fields" }, { status: 400 });
    }

    // Confirm the deal belongs to this account before attaching a
    // contract to it — RLS would reject the FK either way, but this
    // gives a clean 404 instead of a generic insert failure.
    const { data: deal } = await supabase
      .from("deals")
      .select("id")
      .eq("id", dealId)
      .eq("account_id", accountId)
      .maybeSingle();
    if (!deal) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    const { data: contract, error } = await supabase
      .from("deal_contracts")
      .insert({
        account_id: accountId,
        deal_id: dealId,
        template_id: templateId,
        razao_social: razaoSocial,
        cnpj,
        endereco,
        nome_representante: nomeRepresentante,
        cpf_representante: cpfRepresentante,
        client_email: clientEmail,
        signing_method: signingMethod,
        created_by: userId,
      })
      .select()
      .single();

    if (error || !contract) {
      console.error("[contracts] create error:", error);
      return NextResponse.json({ error: "Failed to create contract" }, { status: 500 });
    }

    await supabase.from("deal_contract_events").insert({
      contract_id: contract.id,
      account_id: accountId,
      event_type: "created",
      actor_user_id: userId,
    });

    return NextResponse.json({ contract });
  } catch (err) {
    return toErrorResponse(err);
  }
}
