-- ETAPA 2, Fase 6 -- Pasta do Google Drive por tarefa, na forma mais
-- simples possivel por decisao explicita: sem OAuth, sem Drive API, sem
-- credenciais do Google Cloud (custo/complexidade descartados). A tarefa
-- so guarda o LINK da pasta que o time ja tem acesso; upload/organizacao
-- dos arquivos continua acontecendo no Google Drive normalmente, fora do
-- CRM -- o campo e apenas um atalho.

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS drive_folder_url text;

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
    VALUES (NEW.id, NEW.account_id, auth.uid(), 'assignee_changed', 'Responsavel alterado',
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
      CASE WHEN NEW.is_urgent THEN 'Marcada como urgente' ELSE 'Urgencia removida' END);
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO task_activity (task_id, account_id, user_id, type, title)
    VALUES (NEW.id, NEW.account_id, auth.uid(), CASE WHEN NEW.status = 'done' THEN 'completed' ELSE 'reopened' END,
      CASE WHEN NEW.status = 'done' THEN 'Tarefa concluida' ELSE 'Tarefa reaberta' END);
  END IF;

  IF NEW.drive_folder_url IS DISTINCT FROM OLD.drive_folder_url THEN
    INSERT INTO task_activity (task_id, account_id, user_id, type, title)
    VALUES (NEW.id, NEW.account_id, auth.uid(), 'drive_folder_changed',
      CASE
        WHEN NEW.drive_folder_url IS NULL THEN 'Pasta do Drive removida'
        WHEN OLD.drive_folder_url IS NULL THEN 'Pasta do Drive vinculada'
        ELSE 'Pasta do Drive alterada'
      END);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
