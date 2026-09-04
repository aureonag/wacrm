-- 069_notify_task_assigned_on_create.sql -- ETAPA 3 (fase 2, ajuste):
-- 068's tasks_notify_changes only fires AFTER UPDATE, so a task created
-- with an assignee already set (the "Nova tarefa" dialog has a
-- Responsavel field right there) never notified anyone -- only a later
-- reassignment did. Covers the missed case with its own AFTER INSERT
-- trigger rather than touching notify_task_changes() itself.
--
-- Idempotent -- safe to run multiple times.

CREATE OR REPLACE FUNCTION notify_task_assigned_on_create()
RETURNS TRIGGER AS $$
DECLARE
  v_assignee_user_id uuid;
BEGIN
  IF NEW.assignee_id IS NOT NULL THEN
    SELECT user_id INTO v_assignee_user_id FROM profiles WHERE id = NEW.assignee_id;
    PERFORM emit_task_notification(NEW.id, v_assignee_user_id, 'task_assigned', 'Nova tarefa atribuida a voce', NEW.title);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tasks_notify_assigned_on_create ON tasks;
CREATE TRIGGER tasks_notify_assigned_on_create
  AFTER INSERT ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION notify_task_assigned_on_create();
