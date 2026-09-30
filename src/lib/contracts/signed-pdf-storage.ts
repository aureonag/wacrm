// ============================================================
// Shared "make sure the signed PDF exists, give me its bytes" helper —
// used by the auto-generation on sign (verify-and-accept), the CRM
// download button, and the "send by email" action. Generates it
// on-demand for contracts signed before this feature existed, or if a
// previous generation attempt silently failed (Allan, 2026-09-30).
//
// Works with either the RLS-scoped per-request client (authenticated
// CRM routes) or the service-role admin client (the public
// verify-and-accept route) — both satisfy the `contracts` bucket's
// account-scoped storage policies (migration 053) the same way a
// normal account member's session would.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { generateSignedContractPdf } from "@/lib/contracts/pdf";

export interface EnsureSignedPdfResult {
  path: string;
  buffer: Buffer;
}

export async function ensureSignedContractPdf(
  supabase: SupabaseClient,
  contractId: string,
): Promise<EnsureSignedPdfResult | null> {
  const { data: contract } = await supabase
    .from("deal_contracts")
    .select(
      "account_id, deal_id, status, razao_social, cnpj, endereco, nome_representante, cpf_representante, rendered_content, signed_at, signed_ip, signed_pdf_path",
    )
    .eq("id", contractId)
    .maybeSingle();

  if (!contract || contract.status !== "signed" || !contract.rendered_content || !contract.signed_at) {
    return null;
  }

  if (contract.signed_pdf_path) {
    const { data: file, error } = await supabase.storage.from("contracts").download(contract.signed_pdf_path);
    if (!error && file) {
      const buffer = Buffer.from(await file.arrayBuffer());
      return { path: contract.signed_pdf_path, buffer };
    }
    // Stored path points at an object that's gone missing — fall through
    // and regenerate rather than failing the caller.
  }

  const refCode = contractId.slice(0, 8).toUpperCase();
  const buffer = await generateSignedContractPdf({
    refCode,
    razaoSocial: contract.razao_social,
    cnpj: contract.cnpj,
    endereco: contract.endereco,
    nomeRepresentante: contract.nome_representante,
    cpfRepresentante: contract.cpf_representante,
    renderedContent: contract.rendered_content,
    signedAt: contract.signed_at,
    signedIp: contract.signed_ip,
  });

  const path = `account-${contract.account_id}/${contract.deal_id}/${contractId}-signed.pdf`;
  const { error: uploadError } = await supabase.storage
    .from("contracts")
    .upload(path, buffer, { contentType: "application/pdf", upsert: true });
  if (uploadError) throw uploadError;

  const { error: updateError } = await supabase
    .from("deal_contracts")
    .update({ signed_pdf_path: path })
    .eq("id", contractId);
  if (updateError) throw updateError;

  return { path, buffer };
}
