-- 064_task_recurrence.sql assumed the generic tasks trigger only fires on
-- UPDATE, mirroring what its own comment claimed -- but 060 already added
-- tasks_log_created (AFTER INSERT ON tasks), which logs a plain "Tarefa
-- criada" row on every insert, spawn_recurring_tasks() included. That made
-- every auto-generated occurrence show TWO "created"-type activity rows at
-- the same timestamp. Drop the redundant explicit insert -- the existing
-- trigger already covers it (its user_id is NULL for a cron-run insert,
-- same as any other system-attributed activity; the task's own
-- recurrence_rule_id is what marks it as auto-generated for anyone who
-- needs that signal).

CREATE OR REPLACE FUNCTION spawn_recurring_tasks()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  new_task_id uuid;
  first_stage_id uuid;
BEGIN
  FOR r IN
    SELECT rr.id AS rule_id, rr.rule_type, rr.weekday, rr.day_of_month, rr.next_run_at,
           t.account_id, t.board_id, t.title, t.contact_id, t.sector_id, t.assignee_id,
           t.priority, t.briefing, t.estimated_minutes, t.created_by
    FROM task_recurrence_rules rr
    JOIN tasks t ON t.id = rr.template_task_id
    WHERE rr.active AND rr.next_run_at <= current_date
  LOOP
    SELECT id INTO first_stage_id FROM board_stages WHERE board_id = r.board_id ORDER BY position ASC LIMIT 1;
    IF first_stage_id IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO tasks (
      account_id, board_id, stage_id, title, contact_id, sector_id, assignee_id,
      priority, briefing, estimated_minutes, created_by, recurrence_rule_id
    ) VALUES (
      r.account_id, r.board_id, first_stage_id, r.title, r.contact_id, r.sector_id, r.assignee_id,
      r.priority, r.briefing, r.estimated_minutes, r.created_by, r.rule_id
    )
    RETURNING id INTO new_task_id;

    UPDATE task_recurrence_rules
    SET next_run_at = next_recurrence_date(r.rule_type, r.weekday, r.day_of_month, r.next_run_at)
    WHERE id = r.rule_id;
  END LOOP;
END;
$$;
