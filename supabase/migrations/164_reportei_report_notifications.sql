-- ============================================================
-- 164_reportei_report_notifications.sql -- Sino: relatorio automatico do
-- Reportei pronto (ou que falhou).
--
--   - novos tipos 'report_ready' e 'report_failed' no CHECK de
--     notifications.type (mesma lista da 090, mais os dois);
--   - coluna report_id apontando para o relatorio, apagada junto com ele.
--   As linhas nascem no servidor (rota automations/run, service role);
--   continua sem policy de INSERT para `authenticated`.
--
-- Idempotent -- safe to run multiple times.
-- ============================================================

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS report_id uuid REFERENCES reportei_reports(id) ON DELETE CASCADE;

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
    'deal_won', 'kickoff_task_created',
    'task_updated',
    'report_ready', 'report_failed'
  ));
