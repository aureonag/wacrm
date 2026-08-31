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
