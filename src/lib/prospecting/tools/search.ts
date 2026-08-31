import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../admin-client";
import { startRun } from "../engine";
import { PROSPECTING_MAX_QUANTITY, PROSPECTING_MIN_QUANTITY } from "../constants";
import { assertPipelineOwnership, obterPrimeiraEtapa } from "./pipelines";
import { ProspectingToolError } from "./errors";

/**
 * `pesquisar_empresas` — does NOT run the search inline. It creates
 * the `prospecting_runs` row and kicks off just the first bounded
 * engine step (`startRun`), then returns immediately with whatever
 * progress that first step produced. The rest of the run advances via
 * the cron sweep (`/api/prospecting/cron`) — this keeps one chat turn
 * from blocking on a multi-minute search.
 */
export async function pesquisarEmpresas(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  args: Record<string, unknown>,
) {
  const pipelineId = typeof args.pipeline_id === "string" ? args.pipeline_id : "";
  const niche = typeof args.niche === "string" ? args.niche.trim() : "";
  const region = typeof args.region === "string" ? args.region.trim() : "";
  if (!pipelineId) throw new ProspectingToolError("pipeline_id é obrigatório.");
  if (!niche) throw new ProspectingToolError("O nicho da busca é obrigatório.");
  if (!region) throw new ProspectingToolError("A região da busca é obrigatória.");

  // Ownership re-verified here even though the model already "saw"
  // this pipeline_id via listar_pipelines earlier in the conversation
  // — a prompt-injected or hallucinating model could still pass an
  // arbitrary id.
  await assertPipelineOwnership(db, accountId, pipelineId);
  const { stage_id: entryStageId } = await obterPrimeiraEtapa(db, accountId, { pipeline_id: pipelineId });

  const rawQuantity = Number(args.quantity);
  const quantity = Number.isFinite(rawQuantity)
    ? Math.min(PROSPECTING_MAX_QUANTITY, Math.max(PROSPECTING_MIN_QUANTITY, Math.floor(rawQuantity)))
    : PROSPECTING_MAX_QUANTITY;

  const requiredCriteria = Array.isArray(args.required_criteria) ? args.required_criteria : [];
  const priorityCriteria = Array.isArray(args.priority_criteria) ? args.priority_criteria : [];

  const admin = supabaseAdmin();
  const { data: run, error } = await admin
    .from("prospecting_runs")
    .insert({
      account_id: accountId,
      user_id: userId,
      prompt: `${niche} em ${region}`,
      parsed_request: { niche, region, required_criteria: requiredCriteria, priority_criteria: priorityCriteria },
      pipeline_id: pipelineId,
      entry_stage_id: entryStageId,
      requested_quantity: quantity,
      status: "queued",
    })
    .select()
    .single();

  if (error || !run) {
    console.error("[prospecting] pesquisar_empresas insert error:", error);
    throw new ProspectingToolError("Não foi possível criar a execução de busca.", "internal_error");
  }

  await startRun(run.id as string, admin);

  const { data: refreshed } = await admin
    .from("prospecting_runs")
    .select("status, found_count, error")
    .eq("id", run.id)
    .maybeSingle();

  return {
    run_id: run.id,
    status: refreshed?.status ?? run.status,
    found_count: refreshed?.found_count ?? 0,
    error: refreshed?.error ?? null,
  };
}
