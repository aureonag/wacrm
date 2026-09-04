-- ============================================================
-- 071_task_approvals_stage_requirements.sql -- ETAPA 3 (fase 4):
-- aprovacoes de tarefa + requisitos por etapa do Kanban.
--
-- Design notes
--   - task_approvals e uma tabela nova (nao existe conceito parecido
--     ainda) -- uma tarefa pode ter varias solicitacoes ao longo do
--     tempo, a mais recente e a que vale para o requisito de etapa
--     "requires_approval".
--   - requested_to referencia profiles(id) (mesmo padrao de
--     tasks.assignee_id) porque e "para quem" a solicitacao vai;
--     requested_by/decided_by referenciam auth.users(id) (mesmo padrao
--     de task_comments.user_id) porque sao o ator que praticou a acao.
--   - Notificacoes reusam emit_task_notification() (068) e os tipos
--     approval_requested/approval_approved/approval_rejected, que ja
--     estao no CHECK de notifications.type desde a 067 -- nenhuma
--     alteracao de schema de notifications e necessaria aqui.
--   - Requisitos por etapa sao 3 flags booleanas em board_stages, nao
--     uma tabela de regras generica -- mesma decisao de design do plano
--     aprovado (arquitetura simples, verificavel na propria rota PATCH
--     de tarefas quando stage_id muda). requires_file reaproveita
--     tasks.drive_folder_url (unico mecanismo de arquivo que existe);
--     requires_checklist_complete exige >=1 item em task_checklist_items
--     e todos done; requires_approval exige que a aprovacao mais recente
--     da tarefa tenha status='approved'.
--   - Permissao nova 'operational.tasks.approve' segue o padrao aditivo
--     das migracoes 062/064/066/067/070 -- sem backfill de
--     role_permissions para cargos existentes (o dono da conta sempre
--     passa por ser owner; atribuicao a outros cargos e manual, pela
--     tela de Cargos e permissoes).
--
-- Idempotent -- safe to run multiple times.
-- ============================================================

-- ---- board_stages: requisitos por etapa ------------------------------------
ALTER TABLE board_stages ADD COLUMN IF NOT EXISTS requires_file boolean NOT NULL DEFAULT false;
ALTER TABLE board_stages ADD COLUMN IF NOT EXISTS requires_checklist_complete boolean NOT NULL DEFAULT false;
ALTER TABLE board_stages ADD COLUMN IF NOT EXISTS requires_approval boolean NOT NULL DEFAULT false;

-- ---- task_approvals ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_approvals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id      uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  account_id   uuid NOT NULL REFERENCES accounts(id),
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  requested_to uuid REFERENCES profiles(id) ON DELETE SET NULL,
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  comment      text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at   timestamptz,
  decided_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_task_approvals_task ON task_approvals(task_id, requested_at DESC);

ALTER TABLE task_approvals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS task_approvals_select ON task_approvals;
CREATE POLICY task_approvals_select ON task_approvals FOR SELECT
  USING (is_account_member(account_id) AND has_permission('operational', 'tasks', 'view_tasks'));
DROP POLICY IF EXISTS task_approvals_insert ON task_approvals;
CREATE POLICY task_approvals_insert ON task_approvals FOR INSERT
  WITH CHECK (is_account_member(account_id) AND (
    has_permission('operational', 'tasks', 'edit_tasks') OR has_permission('operational', 'tasks', 'comment')
  ));
DROP POLICY IF EXISTS task_approvals_update ON task_approvals;
CREATE POLICY task_approvals_update ON task_approvals FOR UPDATE
  USING (is_account_member(account_id) AND (
    EXISTS (SELECT 1 FROM profiles p WHERE p.id = task_approvals.requested_to AND p.user_id = auth.uid())
    OR has_permission('operational', 'tasks', 'approve')
  ));

-- ---- notificacoes de aprovacao ----------------------------------------------
CREATE OR REPLACE FUNCTION notify_task_approval_change()
RETURNS TRIGGER AS $$
DECLARE
  v_requested_to_user_id uuid;
  v_task_title text;
BEGIN
  SELECT title INTO v_task_title FROM tasks WHERE id = NEW.task_id;

  IF TG_OP = 'INSERT' THEN
    SELECT user_id INTO v_requested_to_user_id FROM profiles WHERE id = NEW.requested_to;
    PERFORM emit_task_notification(NEW.task_id, v_requested_to_user_id, 'approval_requested',
      'Aprovacao solicitada', v_task_title);
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('approved', 'rejected') THEN
    PERFORM emit_task_notification(NEW.task_id, NEW.requested_by,
      CASE WHEN NEW.status = 'approved' THEN 'approval_approved' ELSE 'approval_rejected' END,
      CASE WHEN NEW.status = 'approved' THEN 'Aprovacao concedida' ELSE 'Aprovacao recusada' END,
      v_task_title);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS task_approvals_notify ON task_approvals;
CREATE TRIGGER task_approvals_notify
  AFTER INSERT OR UPDATE OF status ON task_approvals
  FOR EACH ROW
  EXECUTE FUNCTION notify_task_approval_change();

-- ---- permissao nova -----------------------------------------------------------
INSERT INTO permissions (environment, module, action, label) VALUES
  ('operational', 'tasks', 'approve', 'Aprovar/reprovar solicitacoes')
ON CONFLICT (environment, module, action) DO NOTHING;
