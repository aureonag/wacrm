-- ============================================================
-- 090_task_notifications_audience.sql — Sininho: todo mundo que esta no card
--
-- Ate aqui (068), quase todo evento de tarefa avisava so o RESPONSAVEL.
-- Regra pedida: quem esta no card (responsavel + participantes) recebe
-- TODA notificacao que envolva a tarefa, exceto quem fez a mudanca
-- (emit_task_notification ja descarta o proprio autor).
--
--   - emit_task_notification_audience(): responsavel + participantes,
--     sem repetir pessoa, com opcao de excluir alguem (quem ja recebe uma
--     mensagem mais especifica);
--   - notify_task_changes() reescrita: mesmos eventos de 068, agora para
--     toda a audiencia, e novos eventos "task_updated" para prioridade,
--     setor, cliente, titulo, inicio e tempo estimado;
--   - checklist (item novo / concluido / reaberto) e tags (nova) tambem
--     avisam a audiencia.
--   Comentarios, mencoes, aprovacoes, participante adicionado e atrasos
--   seguem como estavam (068/071).
--   Continua so no sino do CRM — nenhum e-mail ou WhatsApp sai daqui.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

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
    'task_updated'
  ));

CREATE OR REPLACE FUNCTION emit_task_notification_audience(
  p_task_id uuid, p_type text, p_title text, p_body text DEFAULT NULL, p_exclude_user uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user uuid;
BEGIN
  FOR v_user IN
    SELECT DISTINCT u FROM (
      SELECT p.user_id AS u FROM tasks t JOIN profiles p ON p.id = t.assignee_id WHERE t.id = p_task_id
      UNION
      SELECT pr.user_id FROM task_participants tp JOIN profiles pr ON pr.id = tp.profile_id WHERE tp.task_id = p_task_id
    ) x
    WHERE u IS NOT NULL AND (p_exclude_user IS NULL OR u <> p_exclude_user)
  LOOP
    PERFORM emit_task_notification(p_task_id, v_user, p_type, p_title, p_body);
  END LOOP;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'emit_task_notification_audience failed for task %, type %: %', p_task_id, p_type, SQLERRM;
END;
$$;

CREATE OR REPLACE FUNCTION notify_task_changes()
RETURNS TRIGGER AS $$
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

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Subtarefa criada: audiencia da tarefa principal.
CREATE OR REPLACE FUNCTION notify_subtask_created()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.parent_task_id IS NOT NULL THEN
    PERFORM emit_task_notification_audience(NEW.parent_task_id, 'subtask_created', 'Subtarefa adicionada', NEW.title);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---- checklist ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION notify_checklist_change()
RETURNS TRIGGER AS $$
DECLARE
  v_task_title text;
  v_created timestamptz;
BEGIN
  SELECT title, created_at INTO v_task_title, v_created FROM tasks WHERE id = NEW.task_id;
  -- Itens criados junto com a tarefa (ex.: checklist do kickoff) nao geram aviso um a um.
  IF TG_OP = 'INSERT' AND v_created > now() - interval '1 minute' THEN
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
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS task_checklist_items_notify ON task_checklist_items;
CREATE TRIGGER task_checklist_items_notify
  AFTER INSERT OR UPDATE OF done ON task_checklist_items
  FOR EACH ROW
  EXECUTE FUNCTION notify_checklist_change();

-- ---- tags --------------------------------------------------------------------
CREATE OR REPLACE FUNCTION notify_task_tag_added()
RETURNS TRIGGER AS $$
DECLARE
  v_task_title text;
  v_created timestamptz;
BEGIN
  SELECT title, created_at INTO v_task_title, v_created FROM tasks WHERE id = NEW.task_id;
  IF v_created > now() - interval '1 minute' THEN
    RETURN NEW;
  END IF;
  PERFORM emit_task_notification_audience(NEW.task_id, 'task_updated', 'Tag adicionada',
    v_task_title || ' -- ' || NEW.label);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS task_tags_notify ON task_tags;
CREATE TRIGGER task_tags_notify
  AFTER INSERT ON task_tags
  FOR EACH ROW
  EXECUTE FUNCTION notify_task_tag_added();
