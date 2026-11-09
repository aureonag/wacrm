-- Reportei: dashboards de um cliente (Operacional → Reportei → Dashboards), no formato
-- do Reportei v4: blocos por rede com indicadores, periodo e comparacao no topo, dados
-- em tempo real. O documento (blocos e indicadores) fica em `doc`, o mesmo formato dos
-- relatorios; o periodo vale para o dashboard todo.

CREATE TABLE IF NOT EXISTS reportei_dashboards (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id),
  client_id   uuid NOT NULL REFERENCES ops_clients(id) ON DELETE CASCADE,
  title       text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  doc         jsonb NOT NULL,
  period      jsonb NOT NULL,
  compare     boolean NOT NULL DEFAULT true,
  realtime    boolean NOT NULL DEFAULT true,
  networks    text[] NOT NULL DEFAULT '{}',
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reportei_dashboards_client ON reportei_dashboards(client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reportei_dashboards_account ON reportei_dashboards(account_id);

ALTER TABLE reportei_dashboards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reportei_dashboards_select ON reportei_dashboards;
CREATE POLICY reportei_dashboards_select ON reportei_dashboards FOR SELECT
  USING (is_account_member(account_id) AND has_permission('operational', 'tasks', 'view_tasks'));
DROP POLICY IF EXISTS reportei_dashboards_insert ON reportei_dashboards;
CREATE POLICY reportei_dashboards_insert ON reportei_dashboards FOR INSERT
  WITH CHECK (is_account_member(account_id) AND has_permission('operational', 'tasks', 'edit_boards'));
DROP POLICY IF EXISTS reportei_dashboards_update ON reportei_dashboards;
CREATE POLICY reportei_dashboards_update ON reportei_dashboards FOR UPDATE
  USING (is_account_member(account_id) AND has_permission('operational', 'tasks', 'edit_boards'));
DROP POLICY IF EXISTS reportei_dashboards_delete ON reportei_dashboards;
CREATE POLICY reportei_dashboards_delete ON reportei_dashboards FOR DELETE
  USING (is_account_member(account_id) AND has_permission('operational', 'tasks', 'edit_boards'));

DROP TRIGGER IF EXISTS set_updated_at ON reportei_dashboards;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON reportei_dashboards
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
