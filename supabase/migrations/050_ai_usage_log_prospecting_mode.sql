-- ============================================================
-- 050_ai_usage_log_prospecting_mode.sql — Widen ai_usage_log.mode to
-- accept 'prospecting'
--
-- `ai_usage_log` (migration 033) is the single existing token-usage
-- ledger, shared across every AI-driven feature in this CRM. Rather
-- than add a second, competing "which feature spent these tokens"
-- column, this widens the existing `mode` CHECK so Prospecção logs
-- through the exact same `logAiUsage()` call (`src/lib/ai/usage.ts`)
-- everything else already uses.
--
-- IMPORTANT — must ship together with two application-code edits, or
-- a 'prospecting' row will break usage reporting the moment one is
-- written:
--   1. `src/app/api/ai/usage/route.ts` — the `by_mode` aggregation is
--      hardcoded to exactly `{ auto_reply: {...}, draft: {...} }`;
--      `by_mode[row.mode].calls += 1` throws a TypeError on any other
--      mode value unless this object gains a `prospecting` key.
--   2. `src/components/agents/ai-usage.tsx` — the usage card's stat
--      tiles read `by_mode.auto_reply`/`by_mode.draft` directly and
--      need a third tile (or an explicit "other" bucket) for
--      `prospecting` so that spend isn't silently invisible.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE ai_usage_log DROP CONSTRAINT IF EXISTS ai_usage_log_mode_check;

ALTER TABLE ai_usage_log
  ADD CONSTRAINT ai_usage_log_mode_check
  CHECK (mode IN ('auto_reply', 'draft', 'prospecting'));
