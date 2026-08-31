-- ============================================================
-- 041_deal_pipeline_extensions.sql — Deal line items, tags,
-- activity log, comments, next steps + new deal fields
--
-- Backs the reworked Pipeline Kanban + "Novo negócio" modal + deal
-- detail page: deals gain a segment/region/frente(comercial)/media
-- investment/proposal URL, and five new deal-scoped child tables.
--
-- Design notes
--   - `deals.value` remains the single source of truth read by
--     PipelineAnalytics (frozen component) — it's kept in sync from
--     the client whenever `deal_line_items` change, no DB trigger.
--   - `deal_tags` is intentionally separate from the existing
--     account-wide `tags`/`contact_tags` tables — these are
--     per-deal, freeform, not shared across contacts.
--   - RLS mirrors `deals` itself (migration 017) exactly: any
--     account member can read, agent+ can write.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS segment text,
  ADD COLUMN IF NOT EXISTS region text,
  ADD COLUMN IF NOT EXISTS frente_leadgen boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS frente_avr boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS media_investment numeric,
  ADD COLUMN IF NOT EXISTS proposal_url text;

-- ---- deal_line_items ----------------------------------------------
CREATE TABLE IF NOT EXISTS deal_line_items (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id    uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id),
  type       text NOT NULL CHECK (type IN ('mensal', 'pontual')),
  label      text,
  value      numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deal_line_items_deal ON deal_line_items(deal_id);

ALTER TABLE deal_line_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deal_line_items_select ON deal_line_items;
CREATE POLICY deal_line_items_select ON deal_line_items FOR SELECT
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS deal_line_items_insert ON deal_line_items;
CREATE POLICY deal_line_items_insert ON deal_line_items FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS deal_line_items_update ON deal_line_items;
CREATE POLICY deal_line_items_update ON deal_line_items FOR UPDATE
  USING (is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS deal_line_items_delete ON deal_line_items;
CREATE POLICY deal_line_items_delete ON deal_line_items FOR DELETE
  USING (is_account_member(account_id, 'agent'));

-- ---- deal_tags ------------------------------------------------------
CREATE TABLE IF NOT EXISTS deal_tags (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id    uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id),
  label      text NOT NULL,
  color      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deal_tags_deal ON deal_tags(deal_id);

ALTER TABLE deal_tags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deal_tags_select ON deal_tags;
CREATE POLICY deal_tags_select ON deal_tags FOR SELECT
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS deal_tags_insert ON deal_tags;
CREATE POLICY deal_tags_insert ON deal_tags FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS deal_tags_update ON deal_tags;
CREATE POLICY deal_tags_update ON deal_tags FOR UPDATE
  USING (is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS deal_tags_delete ON deal_tags;
CREATE POLICY deal_tags_delete ON deal_tags FOR DELETE
  USING (is_account_member(account_id, 'agent'));

-- ---- deal_activities -------------------------------------------------
CREATE TABLE IF NOT EXISTS deal_activities (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id    uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id),
  user_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  type       text NOT NULL DEFAULT 'note',
  title      text NOT NULL,
  detail     text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deal_activities_deal ON deal_activities(deal_id);

ALTER TABLE deal_activities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deal_activities_select ON deal_activities;
CREATE POLICY deal_activities_select ON deal_activities FOR SELECT
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS deal_activities_insert ON deal_activities;
CREATE POLICY deal_activities_insert ON deal_activities FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS deal_activities_update ON deal_activities;
CREATE POLICY deal_activities_update ON deal_activities FOR UPDATE
  USING (is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS deal_activities_delete ON deal_activities;
CREATE POLICY deal_activities_delete ON deal_activities FOR DELETE
  USING (is_account_member(account_id, 'agent'));

-- ---- deal_comments ----------------------------------------------------
CREATE TABLE IF NOT EXISTS deal_comments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id    uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id),
  user_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  body       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deal_comments_deal ON deal_comments(deal_id);

ALTER TABLE deal_comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deal_comments_select ON deal_comments;
CREATE POLICY deal_comments_select ON deal_comments FOR SELECT
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS deal_comments_insert ON deal_comments;
CREATE POLICY deal_comments_insert ON deal_comments FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS deal_comments_update ON deal_comments;
CREATE POLICY deal_comments_update ON deal_comments FOR UPDATE
  USING (is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS deal_comments_delete ON deal_comments;
CREATE POLICY deal_comments_delete ON deal_comments FOR DELETE
  USING (is_account_member(account_id, 'agent'));

-- ---- deal_next_steps ----------------------------------------------------
CREATE TABLE IF NOT EXISTS deal_next_steps (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id    uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id),
  title      text NOT NULL,
  done       boolean NOT NULL DEFAULT false,
  due_date   date,
  position   int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deal_next_steps_deal ON deal_next_steps(deal_id);

ALTER TABLE deal_next_steps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deal_next_steps_select ON deal_next_steps;
CREATE POLICY deal_next_steps_select ON deal_next_steps FOR SELECT
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS deal_next_steps_insert ON deal_next_steps;
CREATE POLICY deal_next_steps_insert ON deal_next_steps FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS deal_next_steps_update ON deal_next_steps;
CREATE POLICY deal_next_steps_update ON deal_next_steps FOR UPDATE
  USING (is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS deal_next_steps_delete ON deal_next_steps;
CREATE POLICY deal_next_steps_delete ON deal_next_steps FOR DELETE
  USING (is_account_member(account_id, 'agent'));
