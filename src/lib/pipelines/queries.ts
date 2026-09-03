import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Deal,
  DealActivity,
  DealComment,
  DealLineItem,
  DealNextStep,
  DealSearchResult,
  DealTag,
  Pipeline,
  PipelineStage,
  Profile,
} from "@/types";

// Shared between the Pipelines board and the per-pipeline Dashboard —
// both need the same three reads (pipelines, a pipeline's stages, a
// pipeline's deals). Kept here so neither page re-implements the
// Supabase calls independently.

/** Cross-pipeline deal search (Pipelines page's Ctrl+K box) — see the
 *  `search_deals` RPC (migration 055) for the actual join/ranking logic.
 *  Runs SECURITY INVOKER, so RLS already scopes results to the caller's
 *  account. */
export async function searchDeals(
  db: SupabaseClient,
  term: string,
  limit = 10,
): Promise<DealSearchResult[]> {
  const trimmed = term.trim();
  if (!trimmed) return [];
  const { data, error } = await db.rpc("search_deals", { p_search: trimmed, p_limit: limit });
  if (error) {
    console.error("Failed to search deals:", error.message);
    return [];
  }
  return (data ?? []) as DealSearchResult[];
}

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
  let deals = (data ?? []) as Deal[];

  // deals.user_id references auth.users (not profiles), so there's no FK
  // PostgREST can embed through — unlike assigned_to, which points at
  // profiles(id) directly. Resolve creators with one extra lookup keyed
  // by the distinct user_ids actually present, instead of guessing at a
  // constraint name that doesn't exist.
  const creatorIds = [...new Set(deals.map((d) => d.user_id))];
  if (creatorIds.length > 0) {
    const { data: creators } = await db.from("profiles").select("*").in("user_id", creatorIds);
    const creatorByUserId = new Map(((creators ?? []) as Profile[]).map((p) => [p.user_id, p]));
    deals = deals.map((d) => ({ ...d, creator: creatorByUserId.get(d.user_id) }));
  }

  return hydrateLineItemsAndTags(db, deals);
}

/** Batch-attaches `lineItems`/`dealTags` to each deal in one extra query
 *  per child table, keyed by deal id — same "second query + map" shape as
 *  the creator resolution above, since there's no single embed that could
 *  pull both one-to-many child tables at once. */
async function hydrateLineItemsAndTags(db: SupabaseClient, deals: Deal[]): Promise<Deal[]> {
  const dealIds = deals.map((d) => d.id);
  if (dealIds.length === 0) return deals;

  const [{ data: lineItems }, { data: tags }] = await Promise.all([
    db.from("deal_line_items").select("*").in("deal_id", dealIds),
    db.from("deal_tags").select("*").in("deal_id", dealIds),
  ]);

  const lineItemsByDeal = new Map<string, DealLineItem[]>();
  for (const li of (lineItems ?? []) as DealLineItem[]) {
    const bucket = lineItemsByDeal.get(li.deal_id) ?? [];
    bucket.push(li);
    lineItemsByDeal.set(li.deal_id, bucket);
  }

  const tagsByDeal = new Map<string, DealTag[]>();
  for (const tag of (tags ?? []) as DealTag[]) {
    const bucket = tagsByDeal.get(tag.deal_id) ?? [];
    bucket.push(tag);
    tagsByDeal.set(tag.deal_id, bucket);
  }

  return deals.map((d) => ({
    ...d,
    lineItems: lineItemsByDeal.get(d.id) ?? [],
    dealTags: tagsByDeal.get(d.id) ?? [],
  }));
}

/** Full detail for the deal detail page: the deal plus contact, stage,
 *  assignee, creator, line items and tags. Null if not found. */
export async function loadDealById(db: SupabaseClient, dealId: string): Promise<Deal | null> {
  const { data } = await db
    .from("deals")
    .select("*, contact:contacts(*), stage:pipeline_stages(*), assignee:profiles!deals_assigned_to_fkey(*)")
    .eq("id", dealId)
    .maybeSingle();
  if (!data) return null;

  let deal = data as Deal;
  const { data: creator } = await db
    .from("profiles")
    .select("*")
    .eq("user_id", deal.user_id)
    .maybeSingle();
  if (creator) deal = { ...deal, creator: creator as Profile };

  const [hydrated] = await hydrateLineItemsAndTags(db, [deal]);
  return hydrated;
}

export async function loadDealActivities(
  db: SupabaseClient,
  dealId: string,
): Promise<DealActivity[]> {
  const { data } = await db
    .from("deal_activities")
    .select("*")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false });
  return (data ?? []) as DealActivity[];
}

export async function loadDealComments(
  db: SupabaseClient,
  dealId: string,
): Promise<DealComment[]> {
  const { data } = await db
    .from("deal_comments")
    .select("*")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false });
  const comments = (data ?? []) as DealComment[];

  const authorIds = [...new Set(comments.map((c) => c.user_id).filter((id): id is string => !!id))];
  if (authorIds.length === 0) return comments;

  const { data: authors } = await db.from("profiles").select("*").in("user_id", authorIds);
  const authorByUserId = new Map(((authors ?? []) as Profile[]).map((p) => [p.user_id, p]));
  return comments.map((c) => ({ ...c, author: c.user_id ? authorByUserId.get(c.user_id) : undefined }));
}

export async function loadDealNextSteps(
  db: SupabaseClient,
  dealId: string,
): Promise<DealNextStep[]> {
  const { data } = await db
    .from("deal_next_steps")
    .select("*")
    .eq("deal_id", dealId)
    .order("position", { ascending: true });
  return (data ?? []) as DealNextStep[];
}

export interface MyNextStep extends DealNextStep {
  deal: { id: string; title: string; pipeline_id: string };
}

/** Every next step across all deals assigned to one profile — the
 *  "Minhas atividades" page. `!inner` makes the embed filterable so
 *  `.eq('deal.assigned_to', ...)` actually restricts the join instead
 *  of just annotating unrelated rows. */
export async function loadMyNextSteps(
  db: SupabaseClient,
  assignedToProfileId: string,
): Promise<MyNextStep[]> {
  const { data } = await db
    .from("deal_next_steps")
    .select("*, deal:deals!inner(id, title, pipeline_id, assigned_to)")
    .eq("deal.assigned_to", assignedToProfileId)
    .order("due_date", { ascending: true, nullsFirst: false });
  return (data ?? []) as MyNextStep[];
}

/** Sum of a deal's line items by type. */
export function sumLineItems(lineItems: DealLineItem[], type: "mensal" | "pontual"): number {
  return lineItems.filter((li) => li.type === type).reduce((s, li) => s + Number(li.value || 0), 0);
}

/**
 * `deals.value` is the single number PipelineAnalytics (frozen — do not
 * touch) reads for "Valor do pipeline" and friends. Now that a deal's real
 * value lives in `deal_line_items`, we keep `deals.value` as a synced cache:
 * recompute it as sum(mensal), falling back to sum(pontual) when there are
 * no mensal entries, and write it back every time line items change.
 */
export async function syncDealValueFromLineItems(
  db: SupabaseClient,
  dealId: string,
  lineItems: DealLineItem[],
): Promise<number> {
  const mensal = sumLineItems(lineItems, "mensal");
  const value = mensal > 0 ? mensal : sumLineItems(lineItems, "pontual");
  await db.from("deals").update({ value }).eq("id", dealId);
  return value;
}
