import type { SupabaseClient } from "@supabase/supabase-js";
import type { Deal, Pipeline, PipelineStage, Profile } from "@/types";

// Shared between the Pipelines board and the per-pipeline Dashboard —
// both need the same three reads (pipelines, a pipeline's stages, a
// pipeline's deals). Kept here so neither page re-implements the
// Supabase calls independently.

export async function loadPipelines(db: SupabaseClient): Promise<Pipeline[]> {
  const { data, error } = await db.from("pipelines").select("*").order("created_at");
  if (error) {
    console.error("Failed to load pipelines:", error.message);
    return [];
  }
  return (data ?? []) as Pipeline[];
}

export async function loadPipelineStages(
  db: SupabaseClient,
  pipelineId: string,
): Promise<PipelineStage[]> {
  const { data } = await db
    .from("pipeline_stages")
    .select("*")
    .eq("pipeline_id", pipelineId)
    .order("position");
  return (data ?? []) as PipelineStage[];
}

export async function loadPipelineDeals(
  db: SupabaseClient,
  pipelineId: string,
): Promise<Deal[]> {
  const { data } = await db
    .from("deals")
    .select("*, contact:contacts(*), assignee:profiles!deals_assigned_to_fkey(*)")
    .eq("pipeline_id", pipelineId)
    .order("created_at", { ascending: false });
  const deals = (data ?? []) as Deal[];

  // deals.user_id references auth.users (not profiles), so there's no FK
  // PostgREST can embed through — unlike assigned_to, which points at
  // profiles(id) directly. Resolve creators with one extra lookup keyed
  // by the distinct user_ids actually present, instead of guessing at a
  // constraint name that doesn't exist.
  const creatorIds = [...new Set(deals.map((d) => d.user_id))];
  if (creatorIds.length === 0) return deals;

  const { data: creators } = await db.from("profiles").select("*").in("user_id", creatorIds);
  const creatorByUserId = new Map(((creators ?? []) as Profile[]).map((p) => [p.user_id, p]));

  return deals.map((d) => ({ ...d, creator: creatorByUserId.get(d.user_id) }));
}
