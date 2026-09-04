-- ETAPA 2, Fase 4 — 062_timesheet.sql created timesheet_entries but never
-- added it to the supabase_realtime publication. Without this, the
-- Header's persistent ActiveTimerIndicator (mounted before a timer
-- starts elsewhere) never learns about it: its initial snapshot fetch
-- already ran, and no postgres_changes event ever arrives to trigger a
-- refetch. A consumer that mounts AFTER the timer started (e.g. opening
-- the task drawer's Timesheet tab) still works via its own initial
-- fetch — this only fixes the live-update path.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'timesheet_entries'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE timesheet_entries;
  END IF;
END $$;
