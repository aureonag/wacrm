-- Reportei: metas por cliente. Verba mensal e CPC maximo, na moeda da conta de
-- anuncios. Aparecem como selos na visao geral dos Dashboards (andamento da
-- verba no mes e CPC acima da meta). Nada e enviado nem bloqueado.

CREATE TABLE IF NOT EXISTS reportei_client_goals (
  client_id      uuid PRIMARY KEY REFERENCES ops_clients(id) ON DELETE CASCADE,
  account_id     uuid NOT NULL REFERENCES accounts(id),
  monthly_budget numeric(14, 2) CHECK (monthly_budget IS NULL OR monthly_budget > 0),
  max_cpc        numeric(10, 2) CHECK (max_cpc IS NULL OR max_cpc > 0),
  updated_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reportei_client_goals_account ON reportei_client_goals(account_id);

ALTER TABLE reportei_client_goals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reportei_client_goals_select ON reportei_client_goals;
CREATE POLICY reportei_client_goals_select ON reportei_client_goals FOR SELECT
  USING (is_account_member(account_id) AND has_permission('operational', 'tasks', 'view_tasks'));
DROP POLICY IF EXISTS reportei_client_goals_insert ON reportei_client_goals;
CREATE POLICY reportei_client_goals_insert ON reportei_client_goals FOR INSERT
  WITH CHECK (is_account_member(account_id) AND has_permission('operational', 'tasks', 'edit_boards'));
DROP POLICY IF EXISTS reportei_client_goals_update ON reportei_client_goals;
CREATE POLICY reportei_client_goals_update ON reportei_client_goals FOR UPDATE
  USING (is_account_member(account_id) AND has_permission('operational', 'tasks', 'edit_boards'));
DROP POLICY IF EXISTS reportei_client_goals_delete ON reportei_client_goals;
CREATE POLICY reportei_client_goals_delete ON reportei_client_goals FOR DELETE
  USING (is_account_member(account_id) AND has_permission('operational', 'tasks', 'edit_boards'));

DROP TRIGGER IF EXISTS set_updated_at ON reportei_client_goals;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON reportei_client_goals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
