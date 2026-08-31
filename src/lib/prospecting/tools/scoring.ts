import type { SupabaseClient } from "@supabase/supabase-js";
import { scoreIcp } from "../icp-rubric";
import { buildIcpInput } from "../engine";
import { supabaseAdmin } from "../admin-client";
import { loadOwnedCandidate, requireCandidateId } from "./candidates";

export async function pontuarIcp(db: SupabaseClient, accountId: string, args: Record<string, unknown>) {
  const candidateId = requireCandidateId(args);
  const candidate = await loadOwnedCandidate(db, accountId, candidateId);

  const icp = scoreIcp(buildIcpInput(candidate));

  await supabaseAdmin()
    .from("prospecting_candidates")
    .update({ icp_score: icp.score, icp_grade: icp.grade, score_reason: icp.reason })
    .eq("id", candidateId);

  return icp;
}
