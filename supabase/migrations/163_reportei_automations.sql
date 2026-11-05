-- Reportei: automações. Um cliente pode ter um relatório gerado sozinho toda
-- segunda (semanal, últimos 7 dias completos) ou todo dia 1 (mensal, mês
-- anterior), com comparação, gráficos e link público já ligado. Nada é enviado.

CREATE TABLE IF NOT EXISTS reportei_automations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid NOT NULL REFERENCES accounts(id),
  client_id      uuid NOT NULL UNIQUE REFERENCES ops_clients(id) ON DELETE CASCADE,
  frequency      text NOT NULL CHECK (frequency IN ('weekly', 'monthly')),
  active         boolean NOT NULL DEFAULT true,
  last_run_on    date,
  last_report_id uuid REFERENCES reportei_reports(id) ON DELETE SET NULL,
  last_error     text,
  created_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reportei_automations_account ON reportei_automations(account_id);

ALTER TABLE reportei_reports ADD COLUMN IF NOT EXISTS auto boolean NOT NULL DEFAULT false;

ALTER TABLE reportei_automations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reportei_automations_select ON reportei_automations;
CREATE POLICY reportei_automations_select ON reportei_automations FOR SELECT
  USING (is_account_member(account_id) AND has_permission('operational', 'tasks', 'view_tasks'));
DROP POLICY IF EXISTS reportei_automations_insert ON reportei_automations;
CREATE POLICY reportei_automations_insert ON reportei_automations FOR INSERT
  WITH CHECK (is_account_member(account_id) AND has_permission('operational', 'tasks', 'edit_boards'));
DROP POLICY IF EXISTS reportei_automations_update ON reportei_automations;
CREATE POLICY reportei_automations_update ON reportei_automations FOR UPDATE
  USING (is_account_member(account_id) AND has_permission('operational', 'tasks', 'edit_boards'));
DROP POLICY IF EXISTS reportei_automations_delete ON reportei_automations;
CREATE POLICY reportei_automations_delete ON reportei_automations FOR DELETE
  USING (is_account_member(account_id) AND has_permission('operational', 'tasks', 'edit_boards'));

DROP TRIGGER IF EXISTS set_updated_at ON reportei_automations;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON reportei_automations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
