-- Reportei (Operacional → Reportei → Relatórios): relatórios salvos de um cliente.
-- Guarda os números congelados na geração (snapshot) para o período e, se pedido,
-- para o período anterior. Nenhum token fica aqui; a Meta é lida só na geração.

CREATE TABLE IF NOT EXISTS reportei_reports (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES accounts(id),
  client_id     uuid NOT NULL REFERENCES ops_clients(id) ON DELETE CASCADE,
  title         text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  period_start  date NOT NULL,
  period_end    date NOT NULL,
  compare_start date,
  compare_end   date,
  snapshot      jsonb NOT NULL,
  notes         text CHECK (notes IS NULL OR char_length(notes) <= 5000),
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (period_end >= period_start),
  CHECK ((compare_start IS NULL) = (compare_end IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_reportei_reports_account ON reportei_reports(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reportei_reports_client ON reportei_reports(client_id, created_at DESC);

-- RLS (mesmo padrão de ops_clients / ad_integrations)
ALTER TABLE reportei_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reportei_reports_select ON reportei_reports;
CREATE POLICY reportei_reports_select ON reportei_reports FOR SELECT
  USING (is_account_member(account_id) AND has_permission('operational', 'tasks', 'view_tasks'));
DROP POLICY IF EXISTS reportei_reports_insert ON reportei_reports;
CREATE POLICY reportei_reports_insert ON reportei_reports FOR INSERT
  WITH CHECK (is_account_member(account_id) AND has_permission('operational', 'tasks', 'edit_boards'));
DROP POLICY IF EXISTS reportei_reports_update ON reportei_reports;
CREATE POLICY reportei_reports_update ON reportei_reports FOR UPDATE
  USING (is_account_member(account_id) AND has_permission('operational', 'tasks', 'edit_boards'));
DROP POLICY IF EXISTS reportei_reports_delete ON reportei_reports;
CREATE POLICY reportei_reports_delete ON reportei_reports FOR DELETE
  USING (is_account_member(account_id) AND has_permission('operational', 'tasks', 'edit_boards'));

DROP TRIGGER IF EXISTS set_updated_at ON reportei_reports;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON reportei_reports
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
