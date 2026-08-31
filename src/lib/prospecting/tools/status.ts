import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../admin-client";
import { PROSPECTING_TERMINAL_STATUSES } from "../constants";
import { ProspectingToolError } from "./errors";

function requireRunId(args: Record<string, unknown>): string {
  const id = typeof args.run_id === "string" ? args.run_id : "";
  if (!id) throw new ProspectingToolError("run_id é obrigatório.");
  return id;
}

async function loadOwnedRun(db: SupabaseClient, accountId: string, runId: string) {
  const { data } = await db
    .from("prospecting_runs")
    .select("id, status, found_count, validated_count, duplicate_count, imported_count, error")
    .eq("id", runId)
    .eq("account_id", accountId)
    .maybeSingle();
  if (!data) throw new ProspectingToolError("Execução não encontrada ou não pertence a esta conta.", "run_not_found");
  return data;
}

export async function consultarStatusDaPesquisa(db: SupabaseClient, accountId: string, args: Record<string, unknown>) {
  return loadOwnedRun(db, accountId, requireRunId(args));
}

export async function cancelarPesquisa(db: SupabaseClient, accountId: string, args: Record<string, unknown>) {
  const runId = requireRunId(args);
  const run = await loadOwnedRun(db, accountId, runId);

  if (PROSPECTING_TERMINAL_STATUSES.includes(run.status as never)) {
    throw new ProspectingToolError("Esta execução já foi encerrada e não pode ser cancelada.", "run_already_terminal");
  }

  await supabaseAdmin()
    .from("prospecting_runs")
    .update({ status: "cancelled", completed_at: new Date().toISOString() })
    .eq("id", runId);

  return { run_id: runId, status: "cancelled" };
}
