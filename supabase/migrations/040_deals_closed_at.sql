-- Precise "when did this deal close" timestamp.
--
-- `updated_at` bumps on every edit (renaming, notes, reassignment...),
-- not just on the won/lost transition, so it can't be used to report
-- "deals closed this month/quarter" accurately — editing an old closed
-- deal would make it look newly closed. This column is set exactly once
-- (well, once per transition) by a trigger, not by application code, so
-- every write path (UI, automations, public API) gets it for free.

ALTER TABLE deals ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION set_deal_closed_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IN ('won', 'lost') AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    NEW.closed_at := now();
  ELSIF NEW.status = 'open' AND OLD.status IN ('won', 'lost') THEN
    -- Reopening a deal ("Reopen deal" in the UI) clears the close date —
    -- it's no longer closed, so a stale closed_at would misreport it in
    -- month/quarter breakdowns.
    NEW.closed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS deals_set_closed_at ON deals;
CREATE TRIGGER deals_set_closed_at
  BEFORE UPDATE ON deals
  FOR EACH ROW
  EXECUTE FUNCTION set_deal_closed_at();

-- Backfill: deals already won/lost before this migration get a
-- best-effort closed_at from updated_at rather than staying NULL
-- forever (NULL would make them silently invisible in every
-- month/quarter report until someone touches the row again).
UPDATE deals SET closed_at = updated_at
WHERE status IN ('won', 'lost') AND closed_at IS NULL;
