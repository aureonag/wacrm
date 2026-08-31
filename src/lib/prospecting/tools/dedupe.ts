import type { SupabaseClient } from "@supabase/supabase-js";
import { checkDuplicate } from "../dedupe";
import { supabaseAdmin } from "../admin-client";
import { loadOwnedCandidate, requireCandidateId } from "./candidates";

export async function verificarDuplicidade(db: SupabaseClient, accountId: string, args: Record<string, unknown>) {
  const candidateId = requireCandidateId(args);
  const candidate = await loadOwnedCandidate(db, accountId, candidateId);

  const result = await checkDuplicate(db, accountId, {
    googlePlaceId: candidate.google_place_id,
    website: candidate.website,
    phone: candidate.phone,
    instagram: candidate.instagram,
    email: candidate.email,
    companyName: candidate.company_name,
    city: candidate.city,
  });

  await supabaseAdmin()
    .from("prospecting_candidates")
    .update({
      duplicate_status: result.status,
      duplicate_contact_id: result.contactId,
      duplicate_deal_id: result.dealId,
    })
    .eq("id", candidateId);

  return result;
}
