-- Adds `deals` to the supabase_realtime publication so a stage move
-- (drag in the Pipeline board or in the Inbox Kanban view) is reflected
-- live in the other view, instead of requiring a manual refresh/re-nav.
-- Same gap and fix pattern as 063_timesheet_realtime.sql.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'deals'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE deals;
  END IF;
END $$;
