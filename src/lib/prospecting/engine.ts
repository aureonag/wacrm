// ============================================================
// Prospecting: the resumable background-run engine.
//
// `advanceRun(runId, admin)` is the single entry point, called both
// synchronously right after a run is created (so the chat feels
// responsive — see `tools/search.ts`) and by the cron sweep for every
// claimable row. Each call does ONE bounded unit of work for the
// run's current state and either transitions forward (when that
// phase's work is fully done) or returns as-is, leaving the row for
// the next cron tick to continue — mirroring the step-budget idea
// behind `automations/engine.ts`'s wait-step suspension, adapted for
// a state machine with no explicit "wait" step.
//
// ALWAYS uses the service-role admin client — `prospecting_runs` and
// `prospecting_candidates` inserts have no `authenticated` write
// policy (migrations 046/047), by design.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { searchPlacesText, getPlaceDetails, GooglePlacesError, isGooglePlacesConfigured } from "./google-places";
import { analyzeWebsite } from "./website-analyzer";
import { findInstagramFromWebsiteLinks } from "./instagram-lookup";
import { checkDuplicate } from "./dedupe";
import { scoreIcp, type IcpScoringInput } from "./icp-rubric";
import { PROSPECTING_TERMINAL_STATUSES } from "./constants";

const SEARCH_TARGET_MULTIPLIER = 1.5;
const MAX_SEARCH_PAGES = 4; // hard cap regardless of quantity — bounds Google spend per run
const ENRICH_BATCH_SIZE = 5;

interface ProspectingRunRow {
  id: string;
  account_id: string;
  status: string;
  pipeline_id: string;
  entry_stage_id: string;
  requested_quantity: number;
  found_count: number;
  validated_count: number;
  duplicate_count: number;
  parsed_request: { niche?: string; region?: string } | null;
  progress: Record<string, unknown> | null;
}

export interface CandidateRow {
  id: string;
  company_name: string;
  normalized_name: string;
  segment: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  instagram: string | null;
  google_place_id: string | null;
  google_maps_url: string | null;
  google_rating: number | null;
  google_review_count: number | null;
  source_data: Record<string, unknown> | null;
  icp_score: number | null;
}

async function failRun(admin: SupabaseClient, runId: string, message: string): Promise<void> {
  await admin
    .from("prospecting_runs")
    .update({ status: "failed", error: message.slice(0, 2000), completed_at: new Date().toISOString() })
    .eq("id", runId);
}

async function loadCandidates(admin: SupabaseClient, runId: string): Promise<CandidateRow[]> {
  const { data } = await admin.from("prospecting_candidates").select("*").eq("run_id", runId);
  return (data ?? []) as CandidateRow[];
}

function normalizeForDedupe(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

async function stepQueued(admin: SupabaseClient, run: ProspectingRunRow): Promise<void> {
  const { data: pipeline } = await admin
    .from("pipelines")
    .select("id")
    .eq("id", run.pipeline_id)
    .eq("account_id", run.account_id)
    .maybeSingle();
  if (!pipeline) {
    await failRun(admin, run.id, "O pipeline de destino não existe mais ou não pertence a esta conta.");
    return;
  }
  const { data: stage } = await admin
    .from("pipeline_stages")
    .select("id")
    .eq("id", run.entry_stage_id)
    .eq("pipeline_id", run.pipeline_id)
    .maybeSingle();
  if (!stage) {
    await failRun(admin, run.id, "A etapa de destino não existe mais neste pipeline.");
    return;
  }
  await admin.from("prospecting_runs").update({ status: "searching" }).eq("id", run.id);
}

async function stepSearching(admin: SupabaseClient, run: ProspectingRunRow): Promise<void> {
  if (!isGooglePlacesConfigured()) {
    await failRun(admin, run.id, "O Google Places não está configurado nesta instalação.");
    return;
  }

  const niche = run.parsed_request?.niche?.trim();
  const region = run.parsed_request?.region?.trim();
  if (!niche || !region) {
    await failRun(admin, run.id, "Nicho ou região ausentes na solicitação de busca.");
    return;
  }

  const target = Math.ceil(run.requested_quantity * SEARCH_TARGET_MULTIPLIER);
  const pageToken = (run.progress?.next_page_token as string | undefined) ?? undefined;
  const pagesSoFar = (run.progress?.pages_fetched as number | undefined) ?? 0;

  let result;
  try {
    result = await searchPlacesText({ niche, region, pageToken });
  } catch (err) {
    const message = err instanceof GooglePlacesError ? err.message : "Falha ao consultar o Google Places.";
    await failRun(admin, run.id, message);
    return;
  }

  if (result.places.length > 0) {
    const rows = result.places.map((p) => ({
      run_id: run.id,
      account_id: run.account_id,
      company_name: p.companyName,
      normalized_name: normalizeForDedupe(p.companyName),
      segment: niche,
      city: p.city,
      state: p.state,
      address: p.address,
      google_place_id: p.placeId,
    }));
    // Idempotent: the partial unique index on (run_id, google_place_id)
    // means a resumed/duplicated page insert can't double a candidate.
    await admin.from("prospecting_candidates").upsert(rows, { onConflict: "run_id,google_place_id", ignoreDuplicates: true });
  }

  const { count } = await admin
    .from("prospecting_candidates")
    .select("id", { count: "exact", head: true })
    .eq("run_id", run.id);
  const foundCount = count ?? 0;

  const pagesFetched = pagesSoFar + 1;
  const doneSearching = foundCount >= target || !result.nextPageToken || pagesFetched >= MAX_SEARCH_PAGES;

  await admin
    .from("prospecting_runs")
    .update({
      found_count: foundCount,
      status: doneSearching ? "enriching" : "searching",
      progress: doneSearching ? {} : { next_page_token: result.nextPageToken, pages_fetched: pagesFetched },
    })
    .eq("id", run.id);
}

function isEnriched(c: CandidateRow): boolean {
  return !!c.source_data?.enriched_at;
}

async function stepEnriching(admin: SupabaseClient, run: ProspectingRunRow): Promise<void> {
  const candidates = await loadCandidates(admin, run.id);
  const pending = candidates.filter((c) => !isEnriched(c)).slice(0, ENRICH_BATCH_SIZE);

  for (const candidate of pending) {
    const sourceRows: Record<string, unknown>[] = [];
    const update: Record<string, unknown> = {
      source_data: { ...(candidate.source_data ?? {}), enriched_at: new Date().toISOString() },
    };

    if (candidate.google_place_id) {
      try {
        const details = await getPlaceDetails(candidate.google_place_id);
        update.phone = details.phone;
        update.website = details.website;
        update.google_rating = details.rating;
        update.google_review_count = details.reviewCount;
        update.google_maps_url = details.googleMapsUrl;
        if (details.city) update.city = details.city;
        if (details.state) update.state = details.state;
        sourceRows.push({
          candidate_id: candidate.id,
          account_id: run.account_id,
          source_type: "google_places",
          source_url: details.googleMapsUrl,
          confidence: 1,
          raw_metadata: { ...details },
        });
      } catch (err) {
        // Best-effort: a failed enrichment source never invalidates the
        // candidate or the other sources — it just leaves those fields empty.
        sourceRows.push({
          candidate_id: candidate.id,
          account_id: run.account_id,
          source_type: "google_places",
          confidence: 0,
          raw_metadata: { error: err instanceof Error ? err.message : "unknown_error" },
        });
      }
    }

    const website = (update.website as string | undefined) ?? candidate.website;
    if (website) {
      const signals = await analyzeWebsite(website);
      if (signals) {
        (update.source_data as Record<string, unknown>).website_signals = signals;
        sourceRows.push({
          candidate_id: candidate.id,
          account_id: run.account_id,
          source_type: "website",
          source_url: signals.finalUrl,
          confidence: 0.7,
          raw_metadata: { ...signals },
        });

        const instagram = findInstagramFromWebsiteLinks(signals.socialLinks);
        if (instagram.handle) {
          update.instagram = instagram.handle;
          sourceRows.push({
            candidate_id: candidate.id,
            account_id: run.account_id,
            source_type: "instagram",
            source_url: instagram.profileUrl,
            confidence: 0.5,
            raw_metadata: { ...instagram },
          });
        }
      }
    }

    await admin.from("prospecting_candidates").update(update).eq("id", candidate.id);
    if (sourceRows.length > 0) {
      await admin.from("prospecting_sources").insert(sourceRows);
    }
  }

  const remaining = candidates.length - (candidates.filter(isEnriched).length + pending.length);
  const validatedCount = candidates.filter(isEnriched).length + pending.length;

  await admin
    .from("prospecting_runs")
    .update({
      validated_count: validatedCount,
      status: remaining <= 0 ? "scoring" : "enriching",
    })
    .eq("id", run.id);
}

export function buildIcpInput(candidate: CandidateRow): IcpScoringInput {
  const websiteSignals = candidate.source_data?.website_signals as
    | { hasHttps?: boolean; looksResponsive?: boolean | null; hasCallToActionSignal?: boolean; title?: string | null; description?: string | null }
    | undefined;

  const hasWebsite = !!candidate.website;
  const hasStrongStructureSignals = !hasWebsite
    ? null
    : !!(websiteSignals?.title || websiteSignals?.description);

  let digitalImprovementOpportunity: IcpScoringInput["digitalImprovementOpportunity"];
  if (!hasWebsite) {
    digitalImprovementOpportunity = "high";
  } else {
    const strong = !!(websiteSignals?.hasHttps && websiteSignals?.looksResponsive && websiteSignals?.hasCallToActionSignal);
    digitalImprovementOpportunity = strong ? "low" : "medium";
  }

  return {
    // The search query is already scoped to the requested niche/region,
    // so a result returned by it is treated as a match by construction —
    // Google's own relevance ranking is the source of truth here, not a
    // second independent check this codebase doesn't have data for.
    segmentMatch: true,
    regionMatch: true,
    googleRating: candidate.google_rating,
    googleReviewCount: candidate.google_review_count,
    hasStrongStructureSignals,
    digitalImprovementOpportunity,
    hasPhone: !!candidate.phone,
    hasEmail: !!candidate.email,
    hasWebsite,
    otherPositiveSignals: candidate.instagram ? 1 : 0,
  };
}

async function stepScoring(admin: SupabaseClient, run: ProspectingRunRow): Promise<void> {
  const candidates = await loadCandidates(admin, run.id);
  let duplicateCount = 0;

  for (const candidate of candidates) {
    if (candidate.icp_score !== null) continue; // already scored (resumed run)

    const duplicate = await checkDuplicate(admin, run.account_id, {
      googlePlaceId: candidate.google_place_id,
      website: candidate.website,
      phone: candidate.phone,
      instagram: candidate.instagram,
      email: candidate.email,
      companyName: candidate.company_name,
      city: candidate.city,
    });
    if (duplicate.status !== "new") duplicateCount++;

    const icp = scoreIcp(buildIcpInput(candidate));

    await admin
      .from("prospecting_candidates")
      .update({
        duplicate_status: duplicate.status,
        duplicate_contact_id: duplicate.contactId,
        duplicate_deal_id: duplicate.dealId,
        icp_score: icp.score,
        icp_grade: icp.grade,
        score_reason: icp.reason,
        selected: duplicate.status === "new",
      })
      .eq("id", candidate.id);
  }

  await admin
    .from("prospecting_runs")
    .update({ duplicate_count: duplicateCount, status: "awaiting_review" })
    .eq("id", run.id);
}

/** `importing` is driven synchronously by the import route (a later milestone) — the
 * cron only needs to resume a run that got interrupted mid-import. No-op until that
 * route exists; claiming this status is harmless (it just leaves the row as-is). */
async function stepImporting(): Promise<void> {
  // Intentionally empty — see doc comment above.
}

export async function advanceRun(runId: string, admin: SupabaseClient): Promise<void> {
  const { data: run } = await admin.from("prospecting_runs").select("*").eq("id", runId).maybeSingle();
  if (!run) return;

  const status = run.status as string;
  if (PROSPECTING_TERMINAL_STATUSES.includes(status as never) || status === "awaiting_review") return;

  try {
    switch (status) {
      case "queued":
        await stepQueued(admin, run as ProspectingRunRow);
        break;
      case "searching":
        await stepSearching(admin, run as ProspectingRunRow);
        break;
      case "enriching":
        await stepEnriching(admin, run as ProspectingRunRow);
        break;
      case "scoring":
        await stepScoring(admin, run as ProspectingRunRow);
        break;
      case "importing":
        await stepImporting();
        break;
    }
  } catch (err) {
    console.error("[prospecting engine] advanceRun failed:", err);
    await failRun(admin, runId, err instanceof Error ? err.message : "Erro inesperado no motor de prospecção.");
  }
}

/**
 * Kicks off a freshly-created run immediately (bounded — one state
 * transition per call, same as any other `advanceRun` invocation), so
 * the chat can report real progress in the same turn instead of
 * waiting for the next cron tick. Subsequent progress is picked up by
 * the cron sweep regardless of whether this initial call finishes the
 * whole run or not.
 */
export async function startRun(runId: string, admin: SupabaseClient): Promise<void> {
  await advanceRun(runId, admin);
}
