-- ============================================================
-- 057_dashboard_metrics_infra.sql — Infra for the new Dashboard
-- management metrics (conversion by stage, avg time per stage,
-- stalled deals, commercial goal).
--
-- Design notes
--   - `deals.last_activity_at` is deliberately separate from
--     `updated_at` (which bumps on ANY edit, per the comment in
--     040_deals_closed_at.sql) — it only moves on events that
--     represent real commercial activity: a stage change, a new
--     deal_activities/deal_comments row, or a next-step being
--     created/completed.
--   - `deal_stage_history` has no historical data before this
--     migration (stage changes were only ever logged as free-text
--     deal_activities rows, with no from/to columns) — the backfill
--     below seeds one "current state" row per existing deal, which
--     is the only data that actually exists. Conversion/time-per-
--     stage numbers will only become meaningful once deals start
--     moving through stages after this ships.
--   - `deal_goals` mirrors deal_next_steps' RLS shape exactly
--     (select any member, write agent+).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ---- deals.last_activity_at ------------------------------------------
ALTER TABLE deals ADD COLUMN IF NOT EXISTS last_activity_at timestamptz;
UPDATE deals SET last_activity_at = COALESCE(closed_at, updated_at, created_at)
WHERE last_activity_at IS NULL;
ALTER TABLE deals ALTER COLUMN last_activity_at SET DEFAULT now();
ALTER TABLE deals ALTER COLUMN last_activity_at SET NOT NULL;

-- ---- deal_stage_history ------------------------------------------------
CREATE TABLE IF NOT EXISTS deal_stage_history (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id       uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  account_id    uuid NOT NULL REFERENCES accounts(id),
  from_stage_id uuid REFERENCES pipeline_stages(id) ON DELETE SET NULL,
  to_stage_id   uuid NOT NULL REFERENCES pipeline_stages(id) ON DELETE CASCADE,
  changed_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deal_stage_history_deal ON deal_stage_history(deal_id);
CREATE INDEX IF NOT EXISTS idx_deal_stage_history_to_stage ON deal_stage_history(to_stage_id);

ALTER TABLE deal_stage_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deal_stage_history_select ON deal_stage_history;
CREATE POLICY deal_stage_history_select ON deal_stage_history FOR SELECT
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS deal_stage_history_insert ON deal_stage_history;
CREATE POLICY deal_stage_history_insert ON deal_stage_history FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));

-- Backfill: the only "history" that actually exists today is each deal's
-- current stage since its creation — there is no way to reconstruct
-- stages it passed through earlier.
INSERT INTO deal_stage_history (deal_id, account_id, from_stage_id, to_stage_id, changed_at)
SELECT d.id, d.account_id, NULL, d.stage_id, d.created_at
FROM deals d
WHERE NOT EXISTS (SELECT 1 FROM deal_stage_history h WHERE h.deal_id = d.id);

-- Trigger: every deals.stage_id change logs a transition row and bumps
-- last_activity_at. Fires regardless of which UI path changed the stage
-- (Kanban drag or the deal detail dropdown), so neither call site needs
-- to duplicate this logic.
CREATE OR REPLACE FUNCTION log_deal_stage_change()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
    INSERT INTO deal_stage_history (deal_id, account_id, from_stage_id, to_stage_id)
    VALUES (NEW.id, NEW.account_id, OLD.stage_id, NEW.stage_id);
    NEW.last_activity_at := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS deals_log_stage_change ON deals;
CREATE TRIGGER deals_log_stage_change
  BEFORE UPDATE OF stage_id ON deals
  FOR EACH ROW
  EXECUTE FUNCTION log_deal_stage_change();

-- Trigger: a new deal_activities row is real commercial activity.
CREATE OR REPLACE FUNCTION touch_deal_activity_on_deal_activities()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE deals SET last_activity_at = now() WHERE id = NEW.deal_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS deal_activities_touch_last_activity ON deal_activities;
CREATE TRIGGER deal_activities_touch_last_activity
  AFTER INSERT ON deal_activities
  FOR EACH ROW
  EXECUTE FUNCTION touch_deal_activity_on_deal_activities();

-- Trigger: a new comment is real commercial activity.
CREATE OR REPLACE FUNCTION touch_deal_activity_on_deal_comments()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE deals SET last_activity_at = now() WHERE id = NEW.deal_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS deal_comments_touch_last_activity ON deal_comments;
CREATE TRIGGER deal_comments_touch_last_activity
  AFTER INSERT ON deal_comments
  FOR EACH ROW
  EXECUTE FUNCTION touch_deal_activity_on_deal_comments();

-- Trigger: creating a next step, or marking one done/undone, is real
-- commercial activity — editing its title/due date alone is not.
CREATE OR REPLACE FUNCTION touch_deal_activity_on_deal_next_steps()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.done IS DISTINCT FROM OLD.done THEN
    UPDATE deals SET last_activity_at = now() WHERE id = NEW.deal_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS deal_next_steps_touch_last_activity ON deal_next_steps;
CREATE TRIGGER deal_next_steps_touch_last_activity
  AFTER INSERT OR UPDATE OF done ON deal_next_steps
  FOR EACH ROW
  EXECUTE FUNCTION touch_deal_activity_on_deal_next_steps();

-- ---- deal_goals ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS deal_goals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES accounts(id),
  period_month date NOT NULL,
  amount       numeric NOT NULL DEFAULT 0,
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, period_month)
);

ALTER TABLE deal_goals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deal_goals_select ON deal_goals;
CREATE POLICY deal_goals_select ON deal_goals FOR SELECT
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS deal_goals_insert ON deal_goals;
CREATE POLICY deal_goals_insert ON deal_goals FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS deal_goals_update ON deal_goals;
CREATE POLICY deal_goals_update ON deal_goals FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

DROP TRIGGER IF EXISTS set_updated_at ON deal_goals;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON deal_goals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
