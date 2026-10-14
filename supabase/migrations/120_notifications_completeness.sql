-- ============================================================
-- 120_notifications_completeness.sql — nenhuma mudanca na tarefa passa em branco
--
-- Auditoria de 14/10/2026: o envio em tempo real funciona (~40 ms), mas
-- alguns eventos da tarefa nao geravam aviso. Fecha os buracos:
--
--   - remocoes: tag removida, item do checklist removido, participante
--     removido (a pessoa removida e quem segue na tarefa ficam sabendo);
--   - briefing alterado: 1 aviso por tarefa a cada 10 minutos (o editor
--     salva sem parar — sem esse coalescimento seria enxurrada);
--   - checklist/tag adicionados logo depois de criar a tarefa: a janela
--     de "criada junto" cai de 1 minuto para 15 segundos;
--   - prazo se aproximando / atrasada: vai para responsavel E participantes
--     (antes so o responsavel), e o job diario passa para 08:00 de Brasilia
--     (11:00 UTC) em vez de 04:00;
--   - comentario: uma pessoa que e responsavel e participante ao mesmo
--     tempo recebia o aviso duas vezes.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_notifications_task_created
  ON notifications (task_id, created_at DESC);

-- ---- notify_task_changes: + briefing alterado (coalescido) -------------------
CREATE OR REPLACE FUNCTION notify_task_changes()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_new_assignee_user uuid;
  v_old_assignee_user uuid;
  v_name text;
BEGIN
  IF NEW.assignee_id IS DISTINCT FROM OLD.assignee_id THEN
    SELECT user_id INTO v_new_assignee_user FROM profiles WHERE id = NEW.assignee_id;
    SELECT user_id INTO v_old_assignee_user FROM profiles WHERE id = OLD.assignee_id;
    IF NEW.assignee_id IS NOT NULL THEN
      PERFORM emit_task_notification(NEW.id, v_new_assignee_user,
        CASE WHEN OLD.assignee_id IS NULL THEN 'task_assigned' ELSE 'task_reassigned' END,
        CASE WHEN OLD.assignee_id IS NULL THEN 'Nova tarefa atribuida a voce' ELSE 'Tarefa reatribuida a voce' END,
        NEW.title);
    END IF;
    -- Quem saiu da tarefa e os participantes tambem ficam sabendo.
    IF v_old_assignee_user IS NOT NULL AND v_old_assignee_user IS DISTINCT FROM v_new_assignee_user THEN
      PERFORM emit_task_notification(NEW.id, v_old_assignee_user, 'task_updated', 'Tarefa passou para outra pessoa', NEW.title);
    END IF;
    PERFORM emit_task_notification_audience(NEW.id, 'task_updated', 'Responsavel alterado', NEW.title, v_new_assignee_user);
  END IF;

  IF NEW.is_urgent AND NOT OLD.is_urgent THEN
    PERFORM emit_task_notification_audience(NEW.id, 'task_urgent', 'Tarefa marcada como urgente', NEW.title);
  END IF;

  IF NEW.due_date IS DISTINCT FROM OLD.due_date AND NEW.due_date IS NOT NULL THEN
    PERFORM emit_task_notification_audience(NEW.id,
      CASE WHEN OLD.due_date IS NULL THEN 'due_date_set' ELSE 'due_date_changed' END,
      CASE WHEN OLD.due_date IS NULL THEN 'Prazo definido' ELSE 'Prazo alterado' END,
      NEW.title || ' -- ' || to_char(NEW.due_date, 'DD/MM/YYYY'));
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM emit_task_notification_audience(NEW.id,
      CASE WHEN NEW.status = 'done' THEN 'task_completed' ELSE 'task_reopened' END,
      CASE WHEN NEW.status = 'done' THEN 'Tarefa concluida' ELSE 'Tarefa reaberta' END,
      NEW.title);

    IF NEW.status = 'done' AND NEW.parent_task_id IS NOT NULL THEN
      PERFORM emit_task_notification_audience(NEW.parent_task_id, 'subtask_completed', 'Subtarefa concluida', NEW.title);
    END IF;
  END IF;

  IF NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
    SELECT name INTO v_name FROM board_stages WHERE id = NEW.stage_id;
    PERFORM emit_task_notification_audience(NEW.id, 'task_moved', 'Tarefa movida de etapa',
      NEW.title || COALESCE(' -- ' || v_name, ''));
  END IF;

  IF NEW.board_id IS DISTINCT FROM OLD.board_id THEN
    PERFORM emit_task_notification_audience(NEW.id, 'task_transferred', 'Tarefa transferida de quadro', NEW.title);
  END IF;

  IF NEW.drive_folder_url IS DISTINCT FROM OLD.drive_folder_url AND NEW.drive_folder_url IS NOT NULL THEN
    PERFORM emit_task_notification_audience(NEW.id, 'task_file_added', 'Pasta do Drive vinculada', NEW.title);
  END IF;

  IF NEW.priority IS DISTINCT FROM OLD.priority THEN
    PERFORM emit_task_notification_audience(NEW.id, 'task_updated', 'Prioridade alterada', NEW.title);
  END IF;

  IF NEW.sector_id IS DISTINCT FROM OLD.sector_id THEN
    PERFORM emit_task_notification_audience(NEW.id, 'task_updated', 'Setor alterado', NEW.title);
  END IF;

  IF NEW.contact_id IS DISTINCT FROM OLD.contact_id THEN
    PERFORM emit_task_notification_audience(NEW.id, 'task_updated', 'Cliente alterado', NEW.title);
  END IF;

  IF NEW.title IS DISTINCT FROM OLD.title THEN
    PERFORM emit_task_notification_audience(NEW.id, 'task_updated', 'Titulo alterado', NEW.title);
  END IF;

  IF NEW.start_date IS DISTINCT FROM OLD.start_date THEN
    PERFORM emit_task_notification_audience(NEW.id, 'task_updated', 'Data de inicio alterada', NEW.title);
  END IF;

  IF NEW.estimated_minutes IS DISTINCT FROM OLD.estimated_minutes THEN
    PERFORM emit_task_notification_audience(NEW.id, 'task_updated', 'Tempo estimado alterado', NEW.title);
  END IF;

  -- O briefing e salvo a cada pausa na digitacao: um aviso por tarefa a cada 10 min.
  IF NEW.briefing IS DISTINCT FROM OLD.briefing THEN
    IF NOT EXISTS (
      SELECT 1 FROM notifications
      WHERE task_id = NEW.id AND title = 'Briefing alterado' AND created_at > now() - interval '10 minutes'
    ) THEN
      PERFORM emit_task_notification_audience(NEW.id, 'task_updated', 'Briefing alterado', NEW.title);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- ---- checklist: janela de 15 s + item removido -------------------------------
CREATE OR REPLACE FUNCTION notify_checklist_change()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_task_title text;
  v_created timestamptz;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT title INTO v_task_title FROM tasks WHERE id = OLD.task_id;
    IF v_task_title IS NOT NULL THEN
      PERFORM emit_task_notification_audience(OLD.task_id, 'task_updated', 'Item removido do checklist',
        v_task_title || ' -- ' || OLD.label);
    END IF;
    RETURN OLD;
  END IF;

  SELECT title, created_at INTO v_task_title, v_created FROM tasks WHERE id = NEW.task_id;
  -- Itens criados junto com a tarefa (ex.: checklist do kickoff) nao geram aviso um a um.
  IF TG_OP = 'INSERT' AND v_created > now() - interval '15 seconds' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM emit_task_notification_audience(NEW.task_id, 'task_updated', 'Item adicionado ao checklist',
      v_task_title || ' -- ' || NEW.label);
  ELSIF NEW.done IS DISTINCT FROM OLD.done THEN
    PERFORM emit_task_notification_audience(NEW.task_id, 'task_updated',
      CASE WHEN NEW.done THEN 'Item do checklist concluido' ELSE 'Item do checklist reaberto' END,
      v_task_title || ' -- ' || NEW.label);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS task_checklist_items_notify ON task_checklist_items;
CREATE TRIGGER task_checklist_items_notify
  AFTER INSERT OR UPDATE OF done OR DELETE ON task_checklist_items
  FOR EACH ROW
  EXECUTE FUNCTION notify_checklist_change();

-- ---- tags: janela de 15 s + tag removida --------------------------------------
CREATE OR REPLACE FUNCTION notify_task_tag_added()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_task_title text;
  v_created timestamptz;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT title INTO v_task_title FROM tasks WHERE id = OLD.task_id;
    IF v_task_title IS NOT NULL THEN
      PERFORM emit_task_notification_audience(OLD.task_id, 'task_updated', 'Tag removida',
        v_task_title || ' -- ' || OLD.label);
    END IF;
    RETURN OLD;
  END IF;

  SELECT title, created_at INTO v_task_title, v_created FROM tasks WHERE id = NEW.task_id;
  IF v_created > now() - interval '15 seconds' THEN
    RETURN NEW;
  END IF;
  PERFORM emit_task_notification_audience(NEW.task_id, 'task_updated', 'Tag adicionada',
    v_task_title || ' -- ' || NEW.label);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS task_tags_notify ON task_tags;
CREATE TRIGGER task_tags_notify
  AFTER INSERT OR DELETE ON task_tags
  FOR EACH ROW
  EXECUTE FUNCTION notify_task_tag_added();

-- ---- participante removido ------------------------------------------------------
CREATE OR REPLACE FUNCTION notify_task_participant_removed()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_name text;
  v_task_title text;
BEGIN
  SELECT title INTO v_task_title FROM tasks WHERE id = OLD.task_id;
  IF v_task_title IS NULL THEN
    RETURN OLD; -- a tarefa inteira esta sendo apagada
  END IF;
  SELECT user_id, full_name INTO v_user_id, v_name FROM profiles WHERE id = OLD.profile_id;
  PERFORM emit_task_notification(OLD.task_id, v_user_id, 'task_updated', 'Voce foi removido da tarefa', v_task_title);
  PERFORM emit_task_notification_audience(OLD.task_id, 'task_updated', 'Membro removido da tarefa',
    v_task_title || COALESCE(' -- ' || NULLIF(v_name, ''), ''), v_user_id);
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS task_participants_notify_removed ON task_participants;
CREATE TRIGGER task_participants_notify_removed
  AFTER DELETE ON task_participants
  FOR EACH ROW
  EXECUTE FUNCTION notify_task_participant_removed();

-- ---- comentario: uma pessoa, um aviso --------------------------------------------
CREATE OR REPLACE FUNCTION notify_task_comment()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_task_title text;
  v_reply_author_user_id uuid;
BEGIN
  SELECT title INTO v_task_title FROM tasks WHERE id = NEW.task_id;

  IF NEW.parent_comment_id IS NOT NULL THEN
    SELECT user_id INTO v_reply_author_user_id FROM task_comments WHERE id = NEW.parent_comment_id;
  END IF;

  -- Responsavel + participantes, sem repetir pessoa; quem teve o comentario
  -- respondido recebe a mensagem mais especifica abaixo.
  PERFORM emit_task_notification_audience(NEW.task_id, 'task_comment', 'Novo comentario', v_task_title, v_reply_author_user_id);

  IF v_reply_author_user_id IS NOT NULL THEN
    PERFORM emit_task_notification(NEW.task_id, v_reply_author_user_id, 'comment_reply', 'Responderam seu comentario', v_task_title);
  END IF;

  RETURN NEW;
END;
$$;

-- ---- prazo proximo / atrasada: responsavel + participantes ---------------------
CREATE OR REPLACE FUNCTION notify_due_dates()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT t.id AS task_id, t.title
    FROM tasks t
    WHERE t.status = 'open' AND t.due_date = CURRENT_DATE + 1
  LOOP
    PERFORM emit_task_notification_audience(r.task_id, 'due_date_approaching', 'Prazo se aproxima', r.title);
  END LOOP;

  FOR r IN
    SELECT t.id AS task_id, t.title
    FROM tasks t
    WHERE t.status = 'open' AND t.due_date < CURRENT_DATE
      AND (t.overdue_notified_at IS NULL OR t.overdue_notified_at::date < CURRENT_DATE)
  LOOP
    PERFORM emit_task_notification_audience(r.task_id, 'task_overdue', 'Tarefa atrasada', r.title);
    UPDATE tasks SET overdue_notified_at = now() WHERE id = r.task_id;
  END LOOP;
END;
$$;

-- Job diario: 08:00 de Brasilia (11:00 UTC), quando o time comeca o dia.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'notify-due-dates';
    PERFORM cron.schedule('notify-due-dates', '0 11 * * *', 'SELECT notify_due_dates();');
  END IF;
END $$;
