-- ============================================================
-- 083_fin_expenses_unique_period.sql
--
-- Turns fin_expenses into a one-row-per-(category, month) ledger, the
-- same shape as fin_client_values and fin_team_allocations, so the
-- "Lançamentos" UI can become a Linhas-de-serviço-style grid (category
-- rows x month columns, each cell a single editable value) instead of a
-- free-form list. This mirrors the source spreadsheet's own Despesas
-- block, which was never more than one value per category per month.
--
-- Safe to add now: verified no account has two fin_expenses rows for
-- the same (category_id, year, month) as of this migration.
--
-- Idempotent — safe to re-run.
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS uidx_fin_expenses_category_period
  ON fin_expenses(category_id, year, month);
