-- Reportei: foto (logo) do cliente, usada nos cartoes da tela Clientes. O arquivo
-- fica no bucket publico `avatars` (pasta reportei-clients/<cliente>/), enviado
-- pela rota do servidor que confere que e mesmo uma imagem; aqui so a URL.

CREATE TABLE IF NOT EXISTS reportei_client_logos (
  client_id  uuid PRIMARY KEY REFERENCES ops_clients(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id),
  logo_url   text NOT NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reportei_client_logos_account ON reportei_client_logos(account_id);

ALTER TABLE reportei_client_logos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reportei_client_logos_select ON reportei_client_logos;
CREATE POLICY reportei_client_logos_select ON reportei_client_logos FOR SELECT
  USING (is_account_member(account_id) AND has_permission('operational', 'tasks', 'view_tasks'));
DROP POLICY IF EXISTS reportei_client_logos_insert ON reportei_client_logos;
CREATE POLICY reportei_client_logos_insert ON reportei_client_logos FOR INSERT
  WITH CHECK (is_account_member(account_id) AND has_permission('operational', 'tasks', 'edit_boards'));
DROP POLICY IF EXISTS reportei_client_logos_update ON reportei_client_logos;
CREATE POLICY reportei_client_logos_update ON reportei_client_logos FOR UPDATE
  USING (is_account_member(account_id) AND has_permission('operational', 'tasks', 'edit_boards'));
DROP POLICY IF EXISTS reportei_client_logos_delete ON reportei_client_logos;
CREATE POLICY reportei_client_logos_delete ON reportei_client_logos FOR DELETE
  USING (is_account_member(account_id) AND has_permission('operational', 'tasks', 'edit_boards'));
