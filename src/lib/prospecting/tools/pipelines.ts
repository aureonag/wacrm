// ============================================================
// Prospecting tools: pipelines, stages, owners, frentes.
//
// Every handler runs against the RLS-scoped Supabase client from
// `requireRole()` — reads are already tenant-scoped by RLS, but
// `assertPipelineOwnership` re-verifies explicitly rather than
// trusting an empty result set to mean "not found" (a clearer error
// for the model, and a guard that still holds if a handler is ever
// reused against a service-role client that bypasses RLS).
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadPipelines, loadPipelineStages } from "@/lib/pipelines/queries";
import { ProspectingToolError } from "./errors";

export async function assertPipelineOwnership(
  db: SupabaseClient,
  accountId: string,
  pipelineId: string,
): Promise<void> {
  const { data } = await db
    .from("pipelines")
    .select("id")
    .eq("id", pipelineId)
    .eq("account_id", accountId)
    .maybeSingle();
  if (!data) {
    throw new ProspectingToolError(
      "Pipeline não encontrado ou não pertence a esta conta.",
      "pipeline_not_found",
    );
  }
}

export async function listarPipelines(db: SupabaseClient) {
  const pipelines = await loadPipelines(db);
  return pipelines.map((p) => ({ id: p.id, name: p.name }));
}

export async function obterPrimeiraEtapa(
  db: SupabaseClient,
  accountId: string,
  args: { pipeline_id?: unknown },
) {
  const pipelineId = typeof args.pipeline_id === "string" ? args.pipeline_id : "";
  if (!pipelineId) throw new ProspectingToolError("pipeline_id é obrigatório.");
  await assertPipelineOwnership(db, accountId, pipelineId);

  const stages = await loadPipelineStages(db, pipelineId);
  if (stages.length === 0) {
    throw new ProspectingToolError(
      "Este pipeline ainda não tem etapas configuradas.",
      "pipeline_without_stages",
    );
  }
  const first = [...stages].sort((a, b) => a.position - b.position)[0];
  return { stage_id: first.id, stage_name: first.name };
}

export async function listarResponsaveis(db: SupabaseClient) {
  // RLS scopes `profiles` to the caller's own account — no explicit
  // account_id filter needed, matching the existing convention in
  // `deal-create-modal.tsx` and `loadPipelineDeals`.
  const { data, error } = await db.from("profiles").select("user_id, full_name, email").order("full_name");
  if (error) throw new ProspectingToolError("Não foi possível carregar os responsáveis.", "internal_error");
  return (data ?? []).map((p) => ({
    id: p.user_id as string,
    name: (p.full_name as string) || (p.email as string),
  }));
}

/**
 * Fixed two-option set — `deals.frente_leadgen`/`frente_avr` are plain
 * booleans, not a lookup table (see plan decision #10: reuse the
 * existing fields rather than inventing a dynamic frentes catalog).
 */
export function listarFrentes() {
  return [
    { id: "frente_leadgen", name: "Lead Generation" },
    { id: "frente_avr", name: "E-commerce AVR" },
  ];
}
