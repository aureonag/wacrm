-- ============================================================
-- 068_operational_notification_triggers.sql -- ETAPA 3 (fase 2): os
-- gatilhos que realmente populam os tipos de notificacao operacionais
-- que a migracao 067 preparou no schema.
--
-- Design notes
--   - emit_task_notification() e o unico ponto que faz INSERT em
--     notifications a partir daqui -- centraliza 3 regras que, sem isso,
--     precisariam ser repetidas em cada trigger: (1) nunca notificar o
--     proprio autor da mudanca (auth.uid() = destinatario), (2) respeitar
--     notification_preferences (067) antes de inserir, (3) nunca deixar
--     uma falha de notificacao quebrar a escrita que a disparou (mesmo
--     padrao defensivo de handle_contract_signed(), 054). SECURITY
--     DEFINER pelo mesmo motivo de sempre: quem aciona o trigger (o
--     usuario dono da tarefa, ou o pg_cron sem sessao nenhuma) pode nao
--     ter RLS de INSERT em notifications -- e nem deveria, ninguem tem,
--     nem authenticated (ver 027).
--   - Cada trigger de notificacao fica separado do trigger de
--     task_activity/log que ja existe (060/062/066) -- mesmo evento,
--     duas preocupacoes diferentes, dois triggers diferentes. Evita
--     mexer em codigo ja testado da Etapa 2 so para acrescentar uma
--     responsabilidade nova.
--   - briefing_changed nao ganhou gatilho -- o editor salva a cada
--     edicao/debounce, notificar a cada mudanca de briefing inundaria a
--     central de notificacoes; o tipo fica de fora do CHECK (067) ate
--     existir um caso de uso que justifique o ruido.
--   - due_date_approaching/task_overdue nao dependem de nenhuma escrita
--     do usuario -- rodam 1x por dia via pg_cron (mesma extensao ja
--     ligada na Etapa 2 para spawn_recurring_tasks()), lendo o estado
--     atual da tabela. tasks.overdue_notified_at evita notificar a
--     mesma tarefa atrasada mais de 1x por dia (mas permite repetir em
--     dias diferentes enquanto ela seguir atrasada, conforme pedido).
--
-- Idempotent -- safe to run multiple times.
-- ============================================================

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS overdue_notified_at timestamptz;

-- ---- helper central -------------------------------------------------------
CREATE OR REPLACE FUNCTION emit_task_notification(
  p_task_id uuid, p_recipient_user_id uuid, p_type text, p_title text, p_body text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_account_id uuid;
  v_board_id uuid;
BEGIN
  IF p_recipient_user_id IS NULL THEN
    RETURN;
  END IF;
  IF auth.uid() IS NOT NULL AND auth.uid() = p_recipient_user_id THEN
    RETURN;
  END IF;
  IF NOT notification_enabled(p_recipient_user_id, p_type) THEN
    RETURN;
  END IF;

  SELECT account_id, board_id INTO v_account_id, v_board_id FROM tasks WHERE id = p_task_id;
  IF v_account_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO notifications (account_id, user_id, type, task_id, board_id, actor_user_id, title, body)
  VALUES (v_account_id, p_recipient_user_id, p_type, p_task_id, v_board_id, auth.uid(), p_title, p_body);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'emit_task_notification failed for task %, type %: %', p_task_id, p_type, SQLERRM;
END;
$$;

-- ---- responsavel/prazo/urgencia/status/etapa/quadro/arquivo ---------------
CREATE OR REPLACE FUNCTION notify_task_changes()
RETURNS TRIGGER AS $$
DECLARE
  v_assignee_user_id uuid;
  v_parent_assignee_user_id uuid;
BEGIN
  IF NEW.assignee_id IS DISTINCT FROM OLD.assignee_id AND NEW.assignee_id IS NOT NULL THEN
    SELECT user_id INTO v_assignee_user_id FROM profiles WHERE id = NEW.assignee_id;
    PERFORM emit_task_notification(NEW.id, v_assignee_user_id,
      CASE WHEN OLD.assignee_id IS NULL THEN 'task_assigned' ELSE 'task_reassigned' END,
      CASE WHEN OLD.assignee_id IS NULL THEN 'Nova tarefa atribuida a voce' ELSE 'Tarefa reatribuida a voce' END,
      NEW.title);
  END IF;

  IF NEW.is_urgent AND NOT OLD.is_urgent THEN
    SELECT user_id INTO v_assignee_user_id FROM profiles WHERE id = NEW.assignee_id;
    PERFORM emit_task_notification(NEW.id, v_assignee_user_id, 'task_urgent', 'Tarefa marcada como urgente', NEW.title);
  END IF;

  IF NEW.due_date IS DISTINCT FROM OLD.due_date AND NEW.due_date IS NOT NULL THEN
    SELECT user_id INTO v_assignee_user_id FROM profiles WHERE id = NEW.assignee_id;
    PERFORM emit_task_notification(NEW.id, v_assignee_user_id,
      CASE WHEN OLD.due_date IS NULL THEN 'due_date_set' ELSE 'due_date_changed' END,
      CASE WHEN OLD.due_date IS NULL THEN 'Prazo definido' ELSE 'Prazo alterado' END,
      NEW.title || ' -- ' || NEW.due_date::text);
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    SELECT user_id INTO v_assignee_user_id FROM profiles WHERE id = NEW.assignee_id;
    PERFORM emit_task_notification(NEW.id, v_assignee_user_id,
      CASE WHEN NEW.status = 'done' THEN 'task_completed' ELSE 'task_reopened' END,
      CASE WHEN NEW.status = 'done' THEN 'Tarefa concluida' ELSE 'Tarefa reaberta' END,
      NEW.title);

    IF NEW.status = 'done' AND NEW.parent_task_id IS NOT NULL THEN
      SELECT p.user_id INTO v_parent_assignee_user_id
      FROM tasks t JOIN profiles p ON p.id = t.assignee_id
      WHERE t.id = NEW.parent_task_id;
      PERFORM emit_task_notification(NEW.parent_task_id, v_parent_assignee_user_id, 'subtask_completed', 'Subtarefa concluida', NEW.title);
    END IF;
  END IF;

  IF NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
    SELECT user_id INTO v_assignee_user_id FROM profiles WHERE id = NEW.assignee_id;
    PERFORM emit_task_notification(NEW.id, v_assignee_user_id, 'task_moved', 'Tarefa movida de etapa', NEW.title);
  END IF;

  IF NEW.board_id IS DISTINCT FROM OLD.board_id THEN
    SELECT user_id INTO v_assignee_user_id FROM profiles WHERE id = NEW.assignee_id;
    PERFORM emit_task_notification(NEW.id, v_assignee_user_id, 'task_transferred', 'Tarefa transferida de quadro', NEW.title);
  END IF;

  IF NEW.drive_folder_url IS DISTINCT FROM OLD.drive_folder_url AND NEW.drive_folder_url IS NOT NULL THEN
    SELECT user_id INTO v_assignee_user_id FROM profiles WHERE id = NEW.assignee_id;
    PERFORM emit_task_notification(NEW.id, v_assignee_user_id, 'task_file_added', 'Pasta do Drive vinculada', NEW.title);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tasks_notify_changes ON tasks;
CREATE TRIGGER tasks_notify_changes
  AFTER UPDATE ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION notify_task_changes();

-- ---- subtarefa criada -------------------------------------------------------
CREATE OR REPLACE FUNCTION notify_subtask_created()
RETURNS TRIGGER AS $$
DECLARE
  v_assignee_user_id uuid;
BEGIN
  IF NEW.parent_task_id IS NOT NULL THEN
    SELECT p.user_id INTO v_assignee_user_id
    FROM tasks t JOIN profiles p ON p.id = t.assignee_id
    WHERE t.id = NEW.parent_task_id;
    PERFORM emit_task_notification(NEW.parent_task_id, v_assignee_user_id, 'subtask_created', 'Subtarefa adicionada', NEW.title);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tasks_notify_subtask_created ON tasks;
CREATE TRIGGER tasks_notify_subtask_created
  AFTER INSERT OR UPDATE OF parent_task_id ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION notify_subtask_created();

-- ---- comentario + resposta --------------------------------------------------
CREATE OR REPLACE FUNCTION notify_task_comment()
RETURNS TRIGGER AS $$
DECLARE
  v_task_title text;
  v_assignee_user_id uuid;
  v_participant_user_id uuid;
  v_reply_author_user_id uuid;
BEGIN
  SELECT t.title, p.user_id INTO v_task_title, v_assignee_user_id
  FROM tasks t LEFT JOIN profiles p ON p.id = t.assignee_id
  WHERE t.id = NEW.task_id;

  PERFORM emit_task_notification(NEW.task_id, v_assignee_user_id, 'task_comment', 'Novo comentario', v_task_title);

  FOR v_participant_user_id IN
    SELECT pr.user_id FROM task_participants tp JOIN profiles pr ON pr.id = tp.profile_id
    WHERE tp.task_id = NEW.task_id
  LOOP
    PERFORM emit_task_notification(NEW.task_id, v_participant_user_id, 'task_comment', 'Novo comentario', v_task_title);
  END LOOP;

  IF NEW.parent_comment_id IS NOT NULL THEN
    SELECT user_id INTO v_reply_author_user_id FROM task_comments WHERE id = NEW.parent_comment_id;
    PERFORM emit_task_notification(NEW.task_id, v_reply_author_user_id, 'comment_reply', 'Responderam seu comentario', v_task_title);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS task_comments_notify ON task_comments;
CREATE TRIGGER task_comments_notify
  AFTER INSERT ON task_comments
  FOR EACH ROW
  EXECUTE FUNCTION notify_task_comment();

-- ---- mencao em comentario ----------------------------------------------------
CREATE OR REPLACE FUNCTION notify_task_mention()
RETURNS TRIGGER AS $$
DECLARE
  v_user_id uuid;
  v_task_id uuid;
  v_task_title text;
BEGIN
  SELECT user_id INTO v_user_id FROM profiles WHERE id = NEW.profile_id;
  SELECT c.task_id, t.title INTO v_task_id, v_task_title
  FROM task_comments c JOIN tasks t ON t.id = c.task_id
  WHERE c.id = NEW.comment_id;

  PERFORM emit_task_notification(v_task_id, v_user_id, 'task_mention', 'Voce foi mencionado em um comentario', v_task_title);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS task_comment_mentions_notify ON task_comment_mentions;
CREATE TRIGGER task_comment_mentions_notify
  AFTER INSERT ON task_comment_mentions
  FOR EACH ROW
  EXECUTE FUNCTION notify_task_mention();

-- ---- participante adicionado --------------------------------------------------
CREATE OR REPLACE FUNCTION notify_task_participant_added()
RETURNS TRIGGER AS $$
DECLARE
  v_user_id uuid;
  v_task_title text;
BEGIN
  SELECT user_id INTO v_user_id FROM profiles WHERE id = NEW.profile_id;
  SELECT title INTO v_task_title FROM tasks WHERE id = NEW.task_id;
  PERFORM emit_task_notification(NEW.task_id, v_user_id, 'task_participant_added', 'Voce foi adicionado como participante', v_task_title);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS task_participants_notify ON task_participants;
CREATE TRIGGER task_participants_notify
  AFTER INSERT ON task_participants
  FOR EACH ROW
  EXECUTE FUNCTION notify_task_participant_added();

-- ---- prazo proximo / atrasado (job diario) ------------------------------------
CREATE OR REPLACE FUNCTION notify_due_dates()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT t.id AS task_id, t.title, p.user_id AS assignee_user_id
    FROM tasks t JOIN profiles p ON p.id = t.assignee_id
    WHERE t.status = 'open' AND t.due_date = CURRENT_DATE + 1
  LOOP
    PERFORM emit_task_notification(r.task_id, r.assignee_user_id, 'due_date_approaching', 'Prazo se aproxima', r.title);
  END LOOP;

  FOR r IN
    SELECT t.id AS task_id, t.title, p.user_id AS assignee_user_id
    FROM tasks t JOIN profiles p ON p.id = t.assignee_id
    WHERE t.status = 'open' AND t.due_date < CURRENT_DATE
      AND (t.overdue_notified_at IS NULL OR t.overdue_notified_at::date < CURRENT_DATE)
  LOOP
    PERFORM emit_task_notification(r.task_id, r.assignee_user_id, 'task_overdue', 'Tarefa atrasada', r.title);
    UPDATE tasks SET overdue_notified_at = now() WHERE id = r.task_id;
  END LOOP;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'notify-due-dates';
    PERFORM cron.schedule('notify-due-dates', '0 7 * * *', 'SELECT notify_due_dates();');
  END IF;
END $$;
