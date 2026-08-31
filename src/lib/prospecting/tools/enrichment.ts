import type { SupabaseClient } from "@supabase/supabase-js";
import { getPlaceDetails, GooglePlacesError } from "../google-places";
import { analyzeWebsite } from "../website-analyzer";
import { findInstagramFromWebsiteLinks } from "../instagram-lookup";
import { supabaseAdmin } from "../admin-client";
import { ProspectingToolError } from "./errors";
import { loadOwnedCandidate, requireCandidateId } from "./candidates";

/**
 * On-demand, single-candidate enrichment — lets the agent enrich one
 * candidate the user asks about mid-conversation, independent of the
 * engine's own automatic batch enrichment during a run's `enriching`
 * phase. Writes go through the admin client (candidates have no
 * client-writable INSERT/general-UPDATE policy beyond `selected`);
 * ownership is verified first via the caller's own RLS-scoped client.
 */
export async function enriquecerGoogle(db: SupabaseClient, accountId: string, args: Record<string, unknown>) {
  const candidateId = requireCandidateId(args);
  const candidate = await loadOwnedCandidate(db, accountId, candidateId);
  if (!candidate.google_place_id) {
    throw new ProspectingToolError("Este candidato não tem um Google Place ID associado.", "missing_place_id");
  }

  let details;
  try {
    details = await getPlaceDetails(candidate.google_place_id);
  } catch (err) {
    throw new ProspectingToolError(
      err instanceof GooglePlacesError ? err.message : "Falha ao consultar o Google Places.",
      "provider_error",
    );
  }

  const admin = supabaseAdmin();
  await admin
    .from("prospecting_candidates")
    .update({
      phone: details.phone,
      website: details.website,
      google_rating: details.rating,
      google_review_count: details.reviewCount,
      google_maps_url: details.googleMapsUrl,
    })
    .eq("id", candidateId);
  await admin.from("prospecting_sources").insert({
    candidate_id: candidateId,
    account_id: accountId,
    source_type: "google_places",
    source_url: details.googleMapsUrl,
    confidence: 1,
    raw_metadata: { ...details },
  });

  return details;
}

export async function analisarSite(db: SupabaseClient, accountId: string, args: Record<string, unknown>) {
  const candidateId = requireCandidateId(args);
  const candidate = await loadOwnedCandidate(db, accountId, candidateId);
  if (!candidate.website) {
    throw new ProspectingToolError("Este candidato não tem site cadastrado.", "missing_website");
  }

  const signals = await analyzeWebsite(candidate.website);
  if (!signals) {
    throw new ProspectingToolError("Não foi possível acessar ou analisar o site deste candidato.", "website_unreachable");
  }

  const admin = supabaseAdmin();
  await admin
    .from("prospecting_candidates")
    .update({ source_data: { ...(candidate.source_data ?? {}), website_signals: signals } })
    .eq("id", candidateId);
  await admin.from("prospecting_sources").insert({
    candidate_id: candidateId,
    account_id: accountId,
    source_type: "website",
    source_url: signals.finalUrl,
    confidence: 0.7,
    raw_metadata: { ...signals },
  });

  return signals;
}

export async function localizarInstagram(db: SupabaseClient, accountId: string, args: Record<string, unknown>) {
  const candidateId = requireCandidateId(args);
  const candidate = await loadOwnedCandidate(db, accountId, candidateId);
  const websiteSignals = candidate.source_data?.website_signals as { socialLinks?: string[] } | undefined;
  const result = findInstagramFromWebsiteLinks(websiteSignals?.socialLinks ?? []);

  if (result.handle) {
    const admin = supabaseAdmin();
    await admin.from("prospecting_candidates").update({ instagram: result.handle }).eq("id", candidateId);
    await admin.from("prospecting_sources").insert({
      candidate_id: candidateId,
      account_id: accountId,
      source_type: "instagram",
      source_url: result.profileUrl,
      confidence: 0.5,
      raw_metadata: { ...result },
    });
  }

  return result;
}
