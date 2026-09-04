-- Migration 060 was applied by pasting into the Supabase SQL Editor, which
-- corrupted the accented characters in a handful of hardcoded
-- task_activity strings (the UTF-8 bytes for a letter like "i" round
-- tripped through Latin-1 and landed as a different, sometimes invisible,
-- codepoint - e.g. "codo" instead of "codo" with the correct accent).
-- This redefines the three affected trigger functions with correct text
-- (typed directly, not pasted, this time) and backfills rows already
-- written with the corrupted strings, matched structurally by their
-- (unaffected, ASCII) prefix and suffix rather than by the exact
-- corrupted bytes, since the corruption pattern was not consistent
-- across strings.

CREATE OR REPLACE FUNCTION log_task_changes()
RETURNS TRIGGER AS $$
DECLARE
  old_stage_name text;
  new_stage_name text;
  old_assignee_name text;
  new_assignee_name text;
  old_sector_name text;
  new_sector_name text;
BEGIN
  IF NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
    SELECT name INTO old_stage_name FROM board_stages WHERE id = OLD.stage_id;
    SELECT name INTO new_stage_name FROM board_stages WHERE id = NEW.stage_id;
    INSERT INTO task_activity (task_id, account_id, user_id, type, title, detail)
    VALUES (NEW.id, NEW.account_id, auth.uid(), 'stage_changed', 'Etapa alterada',
      format('De "%s" para "%s"', COALESCE(old_stage_name, '-'), COALESCE(new_stage_name, '-')));
  END IF;

  IF NEW.assignee_id IS DISTINCT FROM OLD.assignee_id THEN
    SELECT full_name INTO old_assignee_name FROM profiles WHERE id = OLD.assignee_id;
    SELECT full_name INTO new_assignee_name FROM profiles WHERE id = NEW.assignee_id;
    INSERT INTO task_activity (task_id, account_id, user_id, type, title, detail)
    VALUES (NEW.id, NEW.account_id, auth.uid(), 'assignee_changed', 'Responsável alterado',
      format('De "%s" para "%s"', COALESCE(old_assignee_name, '-'), COALESCE(new_assignee_name, '-')));
  END IF;

  IF NEW.sector_id IS DISTINCT FROM OLD.sector_id THEN
    SELECT name INTO old_sector_name FROM sectors WHERE id = OLD.sector_id;
    SELECT name INTO new_sector_name FROM sectors WHERE id = NEW.sector_id;
    INSERT INTO task_activity (task_id, account_id, user_id, type, title, detail)
    VALUES (NEW.id, NEW.account_id, auth.uid(), 'sector_changed', 'Setor alterado',
      format('De "%s" para "%s"', COALESCE(old_sector_name, '-'), COALESCE(new_sector_name, '-')));
  END IF;

  IF NEW.due_date IS DISTINCT FROM OLD.due_date THEN
    INSERT INTO task_activity (task_id, account_id, user_id, type, title, detail)
    VALUES (NEW.id, NEW.account_id, auth.uid(), 'due_date_changed', 'Prazo alterado',
      format('De %s para %s', COALESCE(OLD.due_date::text, '-'), COALESCE(NEW.due_date::text, '-')));
  END IF;

  IF NEW.priority IS DISTINCT FROM OLD.priority THEN
    INSERT INTO task_activity (task_id, account_id, user_id, type, title, detail)
    VALUES (NEW.id, NEW.account_id, auth.uid(), 'priority_changed', 'Prioridade alterada',
      format('De "%s" para "%s"', OLD.priority, NEW.priority));
  END IF;

  IF NEW.is_urgent IS DISTINCT FROM OLD.is_urgent THEN
    INSERT INTO task_activity (task_id, account_id, user_id, type, title)
    VALUES (NEW.id, NEW.account_id, auth.uid(), 'urgency_changed',
      CASE WHEN NEW.is_urgent THEN 'Marcada como urgente' ELSE 'Urgência removida' END);
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO task_activity (task_id, account_id, user_id, type, title)
    VALUES (NEW.id, NEW.account_id, auth.uid(), CASE WHEN NEW.status = 'done' THEN 'completed' ELSE 'reopened' END,
      CASE WHEN NEW.status = 'done' THEN 'Tarefa concluída' ELSE 'Tarefa reaberta' END);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION log_task_comment_activity()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO task_activity (task_id, account_id, user_id, type, title)
  VALUES (NEW.task_id, NEW.account_id, auth.uid(), 'comment', 'Novo comentário');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION log_task_checklist_activity()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO task_activity (task_id, account_id, user_id, type, title, detail)
    VALUES (NEW.task_id, NEW.account_id, auth.uid(), 'checklist', 'Item de checklist adicionado', NEW.label);
  ELSIF TG_OP = 'UPDATE' AND NEW.done IS DISTINCT FROM OLD.done THEN
    INSERT INTO task_activity (task_id, account_id, user_id, type, title, detail)
    VALUES (NEW.task_id, NEW.account_id, auth.uid(), 'checklist',
      CASE WHEN NEW.done THEN 'Item de checklist concluído' ELSE 'Item de checklist reaberto' END, NEW.label);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Backfill rows already written with the corrupted bytes. Matched
-- structurally (ASCII prefix/suffix) rather than by exact corrupted
-- value, since the corruption was not byte-for-byte consistent.
UPDATE task_activity SET title = 'Responsável alterado'
  WHERE type = 'assignee_changed' AND title LIKE 'Respons%vel alterado';
UPDATE task_activity SET title = 'Urgência removida'
  WHERE type = 'urgency_changed' AND title LIKE 'Urg%ncia removida';
UPDATE task_activity SET title = 'Tarefa concluída'
  WHERE type = 'completed' AND title LIKE 'Tarefa conclu%da';
UPDATE task_activity SET title = 'Novo comentário'
  WHERE type = 'comment' AND title LIKE 'Novo coment%rio';
UPDATE task_activity SET title = 'Item de checklist concluído'
  WHERE type = 'checklist' AND title LIKE 'Item de checklist conclu%do';
