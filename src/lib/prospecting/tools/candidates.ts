import type { SupabaseClient } from "@supabase/supabase-js";
import type { CandidateRow } from "../engine";
import { ProspectingToolError } from "./errors";

/** Every on-demand candidate tool re-verifies ownership this way — `account_id`
 * is denormalized onto `prospecting_candidates` (migration 047) precisely so
 * this check never needs a join through the parent run. */
export async function loadOwnedCandidate(
  db: SupabaseClient,
  accountId: string,
  candidateId: string,
): Promise<CandidateRow> {
  const { data } = await db
    .from("prospecting_candidates")
    .select("*")
    .eq("id", candidateId)
    .eq("account_id", accountId)
    .maybeSingle();
  if (!data) {
    throw new ProspectingToolError("Candidato não encontrado ou não pertence a esta conta.", "candidate_not_found");
  }
  return data as CandidateRow;
}

export function requireCandidateId(args: Record<string, unknown>): string {
  const id = typeof args.candidate_id === "string" ? args.candidate_id : "";
  if (!id) throw new ProspectingToolError("candidate_id é obrigatório.");
  return id;
}
