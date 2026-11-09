-- Reportei: alertas das metas no sino. O cron diario compara o mes corrente de
-- cada cliente com as metas (verba mensal / CPC maximo) e avisa quem salvou a
-- meta, uma vez por mes e por tipo de alerta (a tabela guarda o que ja avisou).

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES ops_clients(id) ON DELETE CASCADE;

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
    'report_ready', 'report_failed',
    'goal_alert'
  ));

CREATE TABLE IF NOT EXISTS reportei_goal_alerts (
  client_id  uuid NOT NULL REFERENCES ops_clients(id) ON DELETE CASCADE,
  month      text NOT NULL CHECK (month ~ '^\d{4}-\d{2}$'),
  kind       text NOT NULL CHECK (kind IN ('budget_attention', 'budget_over', 'cpc_over')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, month, kind)
);

-- Only the server (service role) reads and writes it.
ALTER TABLE reportei_goal_alerts ENABLE ROW LEVEL SECURITY;
