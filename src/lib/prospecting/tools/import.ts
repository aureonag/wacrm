import type { SupabaseClient } from "@supabase/supabase-js";
import { importCandidates } from "../import";
import { ProspectingToolError } from "./errors";

function parseArgs(args: Record<string, unknown>): { runId: string; candidateIds: string[] } {
  const runId = typeof args.run_id === "string" ? args.run_id : "";
  const candidateIds = Array.isArray(args.candidate_ids)
    ? args.candidate_ids.filter((id): id is string => typeof id === "string")
    : [];
  if (!runId) throw new ProspectingToolError("run_id é obrigatório.");
  if (candidateIds.length === 0) throw new ProspectingToolError("candidate_ids não pode ser vazio.");
  return { runId, candidateIds };
}

async function loadOwnedCandidatesSummary(db: SupabaseClient, accountId: string, runId: string, candidateIds: string[]) {
  const { data } = await db
    .from("prospecting_candidates")
    .select("id, company_name, icp_score, icp_grade, duplicate_status, selected, imported_deal_id")
    .eq("run_id", runId)
    .eq("account_id", accountId)
    .in("id", candidateIds);
  return data ?? [];
}

/** Read-only preview — the agent shows this to the user before asking for confirmation. */
export async function prepararImportacao(db: SupabaseClient, accountId: string, args: Record<string, unknown>) {
  const { runId, candidateIds } = parseArgs(args);
  const candidates = await loadOwnedCandidatesSummary(db, accountId, runId, candidateIds);
  if (candidates.length === 0) {
    throw new ProspectingToolError("Nenhum dos candidatos informados pertence a esta execução.", "candidates_not_found");
  }
  return { candidates };
}

/** Writes real contacts/deals — only call after the user has explicitly confirmed in the conversation. */
export async function criarContatosENegocios(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  args: Record<string, unknown>,
) {
  const { runId, candidateIds } = parseArgs(args);
  // Re-verify every id belongs to this account/run before writing
  // anything — never trust the model's list at face value.
  const owned = await loadOwnedCandidatesSummary(db, accountId, runId, candidateIds);
  const ownedIds = new Set(owned.map((c) => c.id as string));
  const validIds = candidateIds.filter((id) => ownedIds.has(id));
  if (validIds.length === 0) {
    throw new ProspectingToolError("Nenhum dos candidatos informados pertence a esta execução.", "candidates_not_found");
  }

  return importCandidates(db, { runId, candidateIds: validIds, accountId, userId });
}
