-- ============================================================
-- 119_user_column_order.sql — ordem dos cartões por usuário
--
-- Nos quadros (tarefas do Operacional e negócios dos Pipelines) cada pessoa
-- pode arrastar os cartões para cima/para baixo dentro de uma coluna. Essa
-- ordem é SÓ DELA: a posição "global" do cartão (tasks.position / deals.position)
-- não muda, e ninguém enxerga a organização do outro.
--
-- Uma linha por (usuário, etapa): `item_ids` guarda os ids na ordem escolhida.
-- Cartões que não estão na lista (novos) aparecem no TOPO da coluna.
--
-- Acesso: cada pessoa lê e grava apenas as próprias linhas. Não mexe em
-- nenhuma tabela, função ou policy existente.
-- Idempotente — seguro para rodar várias vezes.
-- ============================================================

CREATE TABLE IF NOT EXISTS user_column_order (
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- 'task' (board_stages) ou 'deal' (pipeline_stages)
  scope      text NOT NULL CHECK (scope IN ('task', 'deal')),
  stage_id   uuid NOT NULL,
  item_ids   uuid[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, stage_id)
);

CREATE INDEX IF NOT EXISTS idx_user_column_order_account ON user_column_order(account_id);

ALTER TABLE user_column_order ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_column_order_select ON user_column_order;
CREATE POLICY user_column_order_select ON user_column_order FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS user_column_order_insert ON user_column_order;
CREATE POLICY user_column_order_insert ON user_column_order FOR INSERT
  WITH CHECK (user_id = auth.uid() AND is_account_member(account_id));

DROP POLICY IF EXISTS user_column_order_update ON user_column_order;
CREATE POLICY user_column_order_update ON user_column_order FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND is_account_member(account_id));

DROP POLICY IF EXISTS user_column_order_delete ON user_column_order;
CREATE POLICY user_column_order_delete ON user_column_order FOR DELETE
  USING (user_id = auth.uid());
