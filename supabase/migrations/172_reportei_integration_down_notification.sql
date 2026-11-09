-- Reportei: aviso no sino quando a conexao com a Meta cai (token invalido ou
-- revogado). O cron diario testa cada conexao e avisa quem a fez, uma vez, na
-- hora em que ela passa de conectada para com erro.

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
    'goal_alert',
    'integration_down'
  ));
