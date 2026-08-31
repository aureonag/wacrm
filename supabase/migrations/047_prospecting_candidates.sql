-- ============================================================
-- 047_prospecting_candidates.sql — Prospecção: candidates + sources
--
-- One row per company surfaced by a `prospecting_runs` search. Holds
-- everything found across Google Places, website analysis and
-- Instagram lookup, plus the dedup/ICP-score verdicts, so the review
-- table and the "Inteligência comercial" section on an imported deal
-- can read one structured record instead of re-deriving anything.
--
-- Design notes
--   - Fields are only ever set when a source actually returned them —
--     the app layer must never write placeholder text ("Desconhecido",
--     "Não informado") into these columns; a NULL/absent value is the
--     contract for "not found".
--   - `imported_deal_id`/`imported_contact_id` double as the
--     idempotency marker for the import step: `import.ts` checks these
--     are still NULL before creating anything, so re-posting the same
--     "import these candidate ids" request can never create duplicate
--     contacts/deals.
--   - `google_place_id` is unique per run (partial index, NULLs
--     allowed) so re-running enrichment for the same run can't create
--     duplicate rows for the same place.
--   - `prospecting_sources` is the provenance ledger (what was
--     fetched, from where, when, how confidently) — kept separate from
--     `candidates` so a candidate can accumulate multiple source hits
--     (e.g. two different Instagram-discovery heuristics) without
--     overwriting each other.
--
-- RLS
--   candidates: any member reads; agent+ may UPDATE only (the review
--   UI toggles `selected` via the RLS-scoped client) — INSERT/DELETE
--   are service-role only (the engine creates/removes candidates).
--   sources: any member reads; no client write policy (service-role
--   only, populated during enrichment).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ---- prospecting_candidates -----------------------------------------
CREATE TABLE IF NOT EXISTS prospecting_candidates (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                 uuid NOT NULL REFERENCES prospecting_runs(id) ON DELETE CASCADE,
  account_id             uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  company_name           text NOT NULL,
  normalized_name        text NOT NULL,
  contact_name           text,
  segment                text,
  city                   text,
  state                  text,
  address                text,
  phone                  text,
  email                  text,
  website                text,
  instagram              text,
  google_place_id        text,
  google_maps_url        text,
  google_rating          numeric,
  google_review_count    integer,
  instagram_followers    integer,
  instagram_engagement   numeric,
  icp_score              integer CHECK (icp_score BETWEEN 0 AND 100),
  icp_grade              text CHECK (icp_grade IN ('A', 'B', 'C')),
  score_reason           text,
  source_data            jsonb NOT NULL DEFAULT '{}'::jsonb,
  duplicate_status       text NOT NULL DEFAULT 'new'
                           CHECK (duplicate_status IN ('new', 'possible_duplicate', 'existing')),
  duplicate_contact_id   uuid REFERENCES contacts(id) ON DELETE SET NULL,
  duplicate_deal_id      uuid REFERENCES deals(id) ON DELETE SET NULL,
  selected               boolean NOT NULL DEFAULT false,
  imported_contact_id    uuid REFERENCES contacts(id) ON DELETE SET NULL,
  imported_deal_id       uuid REFERENCES deals(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prospecting_candidates_run
  ON prospecting_candidates(run_id);
CREATE INDEX IF NOT EXISTS idx_prospecting_candidates_account
  ON prospecting_candidates(account_id);
CREATE UNIQUE INDEX IF NOT EXISTS uidx_prospecting_candidates_run_place
  ON prospecting_candidates(run_id, google_place_id)
  WHERE google_place_id IS NOT NULL;

ALTER TABLE prospecting_candidates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prospecting_candidates_select ON prospecting_candidates;
CREATE POLICY prospecting_candidates_select ON prospecting_candidates FOR SELECT
  USING (is_account_member(account_id));
-- UPDATE only (agent+): the review UI toggles `selected`. Row creation
-- and deletion stay service-role-only (the engine populates/prunes
-- candidates), so there is no INSERT/DELETE policy here.
DROP POLICY IF EXISTS prospecting_candidates_update ON prospecting_candidates;
CREATE POLICY prospecting_candidates_update ON prospecting_candidates FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

CREATE OR REPLACE FUNCTION public.update_prospecting_candidates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prospecting_candidates_updated_at ON prospecting_candidates;
CREATE TRIGGER prospecting_candidates_updated_at
  BEFORE UPDATE ON prospecting_candidates
  FOR EACH ROW
  EXECUTE FUNCTION public.update_prospecting_candidates_updated_at();

-- ---- prospecting_sources ----------------------------------------------
CREATE TABLE IF NOT EXISTS prospecting_sources (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id   uuid NOT NULL REFERENCES prospecting_candidates(id) ON DELETE CASCADE,
  account_id     uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  source_type    text NOT NULL CHECK (source_type IN ('google_places', 'website', 'instagram', 'manual')),
  source_url     text,
  collected_at   timestamptz NOT NULL DEFAULT now(),
  confidence     numeric,
  raw_metadata   jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_prospecting_sources_candidate
  ON prospecting_sources(candidate_id);

ALTER TABLE prospecting_sources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prospecting_sources_select ON prospecting_sources;
CREATE POLICY prospecting_sources_select ON prospecting_sources FOR SELECT
  USING (is_account_member(account_id));
-- No client write policy — populated exclusively by the service-role
-- enrichment engine.
