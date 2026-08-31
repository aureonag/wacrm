// ============================================================
// Prospecting: shared, versioned constants.
//
// Kept as named constants (not inlined per call site) because the
// quantity bound is enforced in three independent places — the config
// UI, the tool-calling schema, and the API route that creates a run —
// and all three must agree.
// ============================================================

export const PROSPECTING_MIN_QUANTITY = 1;
export const PROSPECTING_MAX_QUANTITY = 50;
export const PROSPECTING_DEFAULT_QUANTITY = 20;
export const PROSPECTING_QUANTITY_PRESETS = [10, 20, 30, 50] as const;

/**
 * Row cap for the external-import path (paste/upload) — a much higher
 * ceiling than the AI-chat search's 50, since this path never calls a
 * paid API per row (only free enrichment: website + Instagram
 * heuristics). Still a real cap, not "infinite", so the batch engine
 * (5 candidates enriched per cron tick) and a single insert never have
 * to handle an unbounded upload.
 */
export const PROSPECTING_EXTERNAL_MAX_ROWS = 1000;

export type ProspectingRunOrigin = "ai_chat" | "external_paste" | "external_upload";

/**
 * Non-terminal, non-"awaiting review" statuses the cron sweep is
 * allowed to claim and advance. `awaiting_review` is deliberately
 * excluded — nothing advances it until a human reviews the results,
 * so claiming it would just be wasted work every tick.
 */
export const PROSPECTING_CLAIMABLE_STATUSES = [
  "queued",
  "searching",
  "enriching",
  "scoring",
  "importing",
] as const;

export const PROSPECTING_TERMINAL_STATUSES = [
  "completed",
  "partially_completed",
  "failed",
  "cancelled",
] as const;

export type ProspectingRunStatus =
  | (typeof PROSPECTING_CLAIMABLE_STATUSES)[number]
  | "awaiting_review"
  | (typeof PROSPECTING_TERMINAL_STATUSES)[number];
