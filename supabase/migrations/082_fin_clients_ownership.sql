-- ============================================================
-- 082_fin_clients_ownership.sql
--
-- Two additions to fin_clients, both requested after the first look at
-- the Financeiro grid:
--   - sort_order: the UI was sorting clients alphabetically, which lost
--     the spreadsheet's original row order (oldest accounts on top,
--     newer ones appended below — the "cascade" of when each account's
--     monthly values start). This restores an explicit, stable order.
--   - responsible_team_member_id: which team member runs a given
--     account (e.g. Matheus vs Mauro's book of clients within the same
--     service line). Distinct from `fin_team_allocations` — that table
--     tracks a person's *cost* to a line per month (including people who
--     never run a specific account, like an art director producing
--     assets for the whole line); this tracks *which accounts* an
--     account-running team member owns, purely for grouping/visibility.
--
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE fin_clients
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS responsible_team_member_id uuid REFERENCES fin_team_members(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_fin_clients_responsible ON fin_clients(responsible_team_member_id);
