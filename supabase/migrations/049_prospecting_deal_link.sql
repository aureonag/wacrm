-- ============================================================
-- 049_prospecting_deal_link.sql — Link an imported deal back to its
-- prospecting candidate
--
-- The only Prospecção-related change to `deals` itself: a single
-- nullable FK so the deal detail page's "Inteligência comercial"
-- section can join the full structured candidate record (Google
-- rating, ICP score/reason, sources, ...) instead of duplicating those
-- columns onto `deals`. Deliberately minimal — everything else lives
-- on `prospecting_candidates`/`prospecting_sources` (migration 047).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS prospecting_candidate_id uuid
    REFERENCES prospecting_candidates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_deals_prospecting_candidate
  ON deals(prospecting_candidate_id)
  WHERE prospecting_candidate_id IS NOT NULL;
