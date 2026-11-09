-- Reportei: registro de atividades. Quem criou, editou ou apagou relatorios,
-- templates, automacoes, integracoes, metas e links. As linhas nascem nas rotas
-- do servidor, com a sessao de quem fez a acao (so quem edita quadros grava);
-- ninguem altera nem apaga o registro.

CREATE TABLE IF NOT EXISTS reportei_activity (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id),
  user_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action     text NOT NULL CHECK (char_length(action) BETWEEN 3 AND 60),
  label      text CHECK (label IS NULL OR char_length(label) <= 300),
  entity_id  uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reportei_activity_account_created ON reportei_activity(account_id, created_at DESC);

ALTER TABLE reportei_activity ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reportei_activity_select ON reportei_activity;
CREATE POLICY reportei_activity_select ON reportei_activity FOR SELECT
  USING (is_account_member(account_id) AND has_permission('operational', 'tasks', 'view_tasks'));
DROP POLICY IF EXISTS reportei_activity_insert ON reportei_activity;
CREATE POLICY reportei_activity_insert ON reportei_activity FOR INSERT
  WITH CHECK (is_account_member(account_id) AND has_permission('operational', 'tasks', 'edit_boards') AND user_id = auth.uid());
