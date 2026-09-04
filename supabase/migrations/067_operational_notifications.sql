-- ============================================================
-- 067_operational_notifications.sql -- ETAPA 3 (fase 1): schema de
-- notificacoes operacionais + permissoes novas de Dashboard/Timesheet.
--
-- Design notes
--   - `notifications` (027, estendida em 054) ja e uma central real, nao
--     um stub -- em vez de criar uma tabela nova para Operacional, esta
--     migracao so (a) adiciona as colunas que faltam para apontar para
--     uma tarefa/quadro, e (b) alarga o CHECK de `type` para os novos
--     eventos operacionais. Continua sem policy de INSERT para
--     `authenticated` -- toda linha nasce de trigger SECURITY DEFINER,
--     mesma regra da 027/054. Os triggers que efetivamente populam os
--     tipos novos entram nas proximas migracoes (fase 2 em diante); esta
--     migracao so prepara o terreno (schema + catalogo de permissoes).
--   - `notification_preferences` e chaveada por `user_id` (auth.users.id),
--     nao por `profile_id` -- mesma chave que `notifications.user_id` ja
--     usa, evita um join extra em todo trigger que for checar preferencia
--     antes de inserir uma notificacao. Ausencia de linha = habilitado
--     (default-on, item 29 do pedido: nao obriga preencher tudo).
--   - `operational.dashboard.{view_own,view_sector,view_all}` sao novos;
--     `operational.dashboard.view` (058) fica intocado como estava (nao
--     e removido, so deixa de ser o unico nivel -- quem ja tiver `view`
--     atribuido continua funcionando, e so que o Dashboard passa a
--     tambem reconhecer os 2 niveis mais amplos). `operational.timesheet.view_team`
--     e novo ao lado do `view` (062) ja existente ("ver o proprio").
--     Mesmo padrao aditivo das migracoes 062/064/066 -- nao faco backfill
--     de `role_permissions` para cargos existentes (o dono da conta
--     sempre passa em `has_permission` por ser owner; atribuicao a outros
--     cargos e manual, pela tela de Cargos e permissoes, como ja e o
--     caso para toda permissao nova desde a 062).
--
-- Idempotent -- safe to run multiple times.
-- ============================================================

-- ---- notifications: novas colunas + CHECK mais amplo ----------------------
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS task_id uuid REFERENCES tasks(id) ON DELETE CASCADE;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS board_id uuid REFERENCES boards(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_notifications_task ON notifications(task_id);

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'conversation_assigned', 'contract_signed',
    'task_assigned', 'task_reassigned', 'task_participant_added',
    'task_moved', 'task_transferred', 'task_completed', 'task_reopened',
    'task_urgent', 'subtask_created', 'subtask_completed',
    'due_date_set', 'due_date_changed', 'due_date_approaching', 'task_overdue',
    'task_comment', 'task_mention', 'comment_reply', 'task_file_added',
    'approval_requested', 'approval_approved', 'approval_rejected',
    'deal_won', 'kickoff_task_created'
  ));

-- ---- notification_preferences ----------------------------------------------
CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type       text NOT NULL,
  enabled    boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, type)
);

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notification_preferences_select ON notification_preferences;
CREATE POLICY notification_preferences_select ON notification_preferences FOR SELECT
  USING (auth.uid() = user_id);
DROP POLICY IF EXISTS notification_preferences_upsert ON notification_preferences;
CREATE POLICY notification_preferences_upsert ON notification_preferences FOR INSERT
  WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS notification_preferences_update ON notification_preferences;
CREATE POLICY notification_preferences_update ON notification_preferences FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS notification_preferences_delete ON notification_preferences;
CREATE POLICY notification_preferences_delete ON notification_preferences FOR DELETE
  USING (auth.uid() = user_id);

-- Helper used by every notification-emitting trigger (SECURITY DEFINER,
-- so it can read another user's preference row from inside a trigger that
-- runs as the acting user, not the recipient).
CREATE OR REPLACE FUNCTION notification_enabled(p_user_id uuid, p_type text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT enabled FROM notification_preferences WHERE user_id = p_user_id AND type = p_type),
    true
  );
$$;

-- ---- permissions: niveis de Dashboard/Timesheet (item 32 do pedido) -------
INSERT INTO permissions (environment, module, action, label) VALUES
  ('operational', 'dashboard', 'view_own', 'Visualizar dados proprios'),
  ('operational', 'dashboard', 'view_sector', 'Visualizar dados do setor'),
  ('operational', 'dashboard', 'view_all', 'Visualizar dados de todos os setores'),
  ('operational', 'timesheet', 'view_team', 'Visualizar timesheet da equipe')
ON CONFLICT (environment, module, action) DO NOTHING;
