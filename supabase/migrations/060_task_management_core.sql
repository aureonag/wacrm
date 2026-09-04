-- ============================================================
-- 060_task_management_core.sql — ETAPA 2 (fase 1): núcleo de
-- Quadros/Kanban/Tarefas do ambiente Operacional.
--
-- Design notes
--   - Espelha a arquitetura de pipelines/deals (Comercial):
--     boards ≈ pipelines, board_stages ≈ pipeline_stages,
--     tasks ≈ deals. Mesma convenção de RLS (is_account_member),
--     mesmo padrão de histórico via trigger (deal_stage_history).
--   - Diferença deliberada: ao contrário de deals (só RLS, sem rotas
--     de API), as escritas deste módulo passam por rotas reais em
--     src/app/api/operational/**, cada uma chamando
--     requirePermission('operational','tasks',<action>) — RLS aqui
--     é defesa em profundidade (is_account_member + has_permission),
--     não a única linha de proteção. has_permission()/is_account_member()
--     já existem (migration 058), nenhuma permissão nova precisa ser
--     inserida nesta migração — o catálogo 'operational.tasks.*' já
--     cobre tudo que esta fase precisa.
--   - Subtarefas NÃO são uma tabela separada: são a própria tabela
--     `tasks` com `parent_task_id` preenchido — "converter em
--     subtarefa" vira um UPDATE de uma coluna só.
--   - `task_activity` é povoado por um trigger genérico
--     (log_task_changes) que cobre responsável/setor/etapa/prazo/
--     prioridade/urgência/conclusão automaticamente — ao contrário de
--     deal_activities (que só loga em 2 pontos manuais do código),
--     aqui a cobertura não depende de nenhuma tela lembrar de logar.
--   - `task_stage_history` é o equivalente exato de
--     `deal_stage_history` (057): trigger BEFORE UPDATE OF stage_id,
--     não código de aplicação — pega toda mudança de etapa não
--     importa o caminho de UI (drag no kanban ou dropdown no drawer).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ---- boards --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS boards (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id),
  name        text NOT NULL,
  description text,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE boards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS boards_select ON boards;
CREATE POLICY boards_select ON boards FOR SELECT
  USING (is_account_member(account_id) AND has_permission('operational', 'tasks', 'view_boards'));
DROP POLICY IF EXISTS boards_insert ON boards;
CREATE POLICY boards_insert ON boards FOR INSERT
  WITH CHECK (is_account_member(account_id) AND has_permission('operational', 'tasks', 'create_boards'));
DROP POLICY IF EXISTS boards_update ON boards;
CREATE POLICY boards_update ON boards FOR UPDATE
  USING (is_account_member(account_id) AND has_permission('operational', 'tasks', 'edit_boards'));
DROP POLICY IF EXISTS boards_delete ON boards;
CREATE POLICY boards_delete ON boards FOR DELETE
  USING (is_account_member(account_id) AND has_permission('operational', 'tasks', 'delete_boards'));

DROP TRIGGER IF EXISTS set_updated_at ON boards;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON boards
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---- board_stages ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS board_stages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id   uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  name       text NOT NULL,
  position   int NOT NULL DEFAULT 0,
  color      text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_board_stages_board ON board_stages(board_id);

ALTER TABLE board_stages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS board_stages_select ON board_stages;
CREATE POLICY board_stages_select ON board_stages FOR SELECT
  USING (EXISTS (SELECT 1 FROM boards b WHERE b.id = board_stages.board_id
    AND is_account_member(b.account_id) AND has_permission('operational', 'tasks', 'view_boards')));
DROP POLICY IF EXISTS board_stages_insert ON board_stages;
CREATE POLICY board_stages_insert ON board_stages FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM boards b WHERE b.id = board_stages.board_id
    AND is_account_member(b.account_id) AND has_permission('operational', 'tasks', 'edit_boards')));
DROP POLICY IF EXISTS board_stages_update ON board_stages;
CREATE POLICY board_stages_update ON board_stages FOR UPDATE
  USING (EXISTS (SELECT 1 FROM boards b WHERE b.id = board_stages.board_id
    AND is_account_member(b.account_id) AND has_permission('operational', 'tasks', 'edit_boards')));
DROP POLICY IF EXISTS board_stages_delete ON board_stages;
CREATE POLICY board_stages_delete ON board_stages FOR DELETE
  USING (EXISTS (SELECT 1 FROM boards b WHERE b.id = board_stages.board_id
    AND is_account_member(b.account_id) AND has_permission('operational', 'tasks', 'edit_boards')));

-- ---- tasks -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tasks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES accounts(id),
  board_id          uuid NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  stage_id          uuid NOT NULL REFERENCES board_stages(id) ON DELETE RESTRICT,
  parent_task_id    uuid REFERENCES tasks(id) ON DELETE SET NULL,
  title             text NOT NULL,
  contact_id        uuid REFERENCES contacts(id) ON DELETE SET NULL,
  sector_id         uuid REFERENCES sectors(id) ON DELETE SET NULL,
  assignee_id       uuid REFERENCES profiles(id) ON DELETE SET NULL,
  priority          text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  is_urgent         boolean NOT NULL DEFAULT false,
  briefing          jsonb,
  position          int NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  start_date        date,
  due_date          date,
  estimated_minutes int,
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  completed_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tasks_board ON tasks(board_id);
CREATE INDEX IF NOT EXISTS idx_tasks_stage ON tasks(stage_id);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_account ON tasks(account_id);

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tasks_select ON tasks;
CREATE POLICY tasks_select ON tasks FOR SELECT
  USING (is_account_member(account_id) AND has_permission('operational', 'tasks', 'view_tasks'));
DROP POLICY IF EXISTS tasks_insert ON tasks;
CREATE POLICY tasks_insert ON tasks FOR INSERT
  WITH CHECK (is_account_member(account_id) AND has_permission('operational', 'tasks', 'create_tasks'));
DROP POLICY IF EXISTS tasks_update ON tasks;
CREATE POLICY tasks_update ON tasks FOR UPDATE
  USING (is_account_member(account_id) AND (
    has_permission('operational', 'tasks', 'edit_tasks') OR has_permission('operational', 'tasks', 'move_tasks')
  ));
DROP POLICY IF EXISTS tasks_delete ON tasks;
CREATE POLICY tasks_delete ON tasks FOR DELETE
  USING (is_account_member(account_id) AND has_permission('operational', 'tasks', 'delete_tasks'));

DROP TRIGGER IF EXISTS set_updated_at ON tasks;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Mirrors set_deal_closed_at(): status='done' stamps completed_at, moving
-- back to 'open' clears it (reabertura).
CREATE OR REPLACE FUNCTION set_task_completed_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'done' AND OLD.status IS DISTINCT FROM 'done' THEN
    NEW.completed_at := now();
  ELSIF NEW.status = 'open' AND OLD.status IS DISTINCT FROM 'open' THEN
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tasks_set_completed_at ON tasks;
CREATE TRIGGER tasks_set_completed_at
  BEFORE UPDATE OF status ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION set_task_completed_at();

-- ---- task_participants (seguidores além do responsável) --------------------
CREATE TABLE IF NOT EXISTS task_participants (
  task_id    uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, profile_id)
);

ALTER TABLE task_participants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS task_participants_select ON task_participants;
CREATE POLICY task_participants_select ON task_participants FOR SELECT
  USING (EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_participants.task_id
    AND is_account_member(t.account_id) AND has_permission('operational', 'tasks', 'view_tasks')));
DROP POLICY IF EXISTS task_participants_insert ON task_participants;
CREATE POLICY task_participants_insert ON task_participants FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_participants.task_id
    AND is_account_member(t.account_id) AND has_permission('operational', 'tasks', 'edit_tasks')));
DROP POLICY IF EXISTS task_participants_delete ON task_participants;
CREATE POLICY task_participants_delete ON task_participants FOR DELETE
  USING (EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_participants.task_id
    AND is_account_member(t.account_id) AND has_permission('operational', 'tasks', 'edit_tasks')));

-- ---- task_tags (livre por tarefa, mesmo padrão de deal_tags) ----------------
CREATE TABLE IF NOT EXISTS task_tags (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id    uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id),
  label      text NOT NULL,
  color      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_task_tags_task ON task_tags(task_id);

ALTER TABLE task_tags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS task_tags_select ON task_tags;
CREATE POLICY task_tags_select ON task_tags FOR SELECT
  USING (is_account_member(account_id) AND has_permission('operational', 'tasks', 'view_tasks'));
DROP POLICY IF EXISTS task_tags_insert ON task_tags;
CREATE POLICY task_tags_insert ON task_tags FOR INSERT
  WITH CHECK (is_account_member(account_id) AND has_permission('operational', 'tasks', 'edit_tasks'));
DROP POLICY IF EXISTS task_tags_delete ON task_tags;
CREATE POLICY task_tags_delete ON task_tags FOR DELETE
  USING (is_account_member(account_id) AND has_permission('operational', 'tasks', 'edit_tasks'));

-- ---- task_checklist_items ----------------------------------------------------
CREATE TABLE IF NOT EXISTS task_checklist_items (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id    uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id),
  label      text NOT NULL,
  done       boolean NOT NULL DEFAULT false,
  position   int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_task_checklist_items_task ON task_checklist_items(task_id);

ALTER TABLE task_checklist_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS task_checklist_items_select ON task_checklist_items;
CREATE POLICY task_checklist_items_select ON task_checklist_items FOR SELECT
  USING (is_account_member(account_id) AND has_permission('operational', 'tasks', 'view_tasks'));
DROP POLICY IF EXISTS task_checklist_items_insert ON task_checklist_items;
CREATE POLICY task_checklist_items_insert ON task_checklist_items FOR INSERT
  WITH CHECK (is_account_member(account_id) AND has_permission('operational', 'tasks', 'edit_tasks'));
DROP POLICY IF EXISTS task_checklist_items_update ON task_checklist_items;
CREATE POLICY task_checklist_items_update ON task_checklist_items FOR UPDATE
  USING (is_account_member(account_id) AND has_permission('operational', 'tasks', 'edit_tasks'));
DROP POLICY IF EXISTS task_checklist_items_delete ON task_checklist_items;
CREATE POLICY task_checklist_items_delete ON task_checklist_items FOR DELETE
  USING (is_account_member(account_id) AND has_permission('operational', 'tasks', 'edit_tasks'));

-- ---- task_comments (+ respostas) ---------------------------------------------
CREATE TABLE IF NOT EXISTS task_comments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id           uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  account_id        uuid NOT NULL REFERENCES accounts(id),
  user_id           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  body              text NOT NULL,
  parent_comment_id uuid REFERENCES task_comments(id) ON DELETE CASCADE,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments(task_id);

ALTER TABLE task_comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS task_comments_select ON task_comments;
CREATE POLICY task_comments_select ON task_comments FOR SELECT
  USING (is_account_member(account_id) AND has_permission('operational', 'tasks', 'view_tasks'));
DROP POLICY IF EXISTS task_comments_insert ON task_comments;
CREATE POLICY task_comments_insert ON task_comments FOR INSERT
  WITH CHECK (is_account_member(account_id) AND has_permission('operational', 'tasks', 'comment'));
DROP POLICY IF EXISTS task_comments_delete ON task_comments;
CREATE POLICY task_comments_delete ON task_comments FOR DELETE
  USING (is_account_member(account_id) AND has_permission('operational', 'tasks', 'comment'));

-- ---- task_comment_mentions (arquitetura para notificações da Etapa 3 —
-- sem nenhum disparo/gatilho ainda, só o registro de quem foi citado) --------
CREATE TABLE IF NOT EXISTS task_comment_mentions (
  comment_id uuid NOT NULL REFERENCES task_comments(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  PRIMARY KEY (comment_id, profile_id)
);

ALTER TABLE task_comment_mentions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS task_comment_mentions_select ON task_comment_mentions;
CREATE POLICY task_comment_mentions_select ON task_comment_mentions FOR SELECT
  USING (EXISTS (SELECT 1 FROM task_comments c WHERE c.id = task_comment_mentions.comment_id
    AND is_account_member(c.account_id)));
DROP POLICY IF EXISTS task_comment_mentions_insert ON task_comment_mentions;
CREATE POLICY task_comment_mentions_insert ON task_comment_mentions FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM task_comments c WHERE c.id = task_comment_mentions.comment_id
    AND is_account_member(c.account_id) AND has_permission('operational', 'tasks', 'comment')));

-- ---- task_stage_history (mesmo padrão de deal_stage_history, 057) -----------
CREATE TABLE IF NOT EXISTS task_stage_history (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id       uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  account_id    uuid NOT NULL REFERENCES accounts(id),
  from_stage_id uuid REFERENCES board_stages(id) ON DELETE SET NULL,
  to_stage_id   uuid NOT NULL REFERENCES board_stages(id) ON DELETE CASCADE,
  changed_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_task_stage_history_task ON task_stage_history(task_id);

ALTER TABLE task_stage_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS task_stage_history_select ON task_stage_history;
CREATE POLICY task_stage_history_select ON task_stage_history FOR SELECT
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS task_stage_history_insert ON task_stage_history;
CREATE POLICY task_stage_history_insert ON task_stage_history FOR INSERT
  WITH CHECK (is_account_member(account_id));

CREATE OR REPLACE FUNCTION log_task_stage_change()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
    INSERT INTO task_stage_history (task_id, account_id, from_stage_id, to_stage_id)
    VALUES (NEW.id, NEW.account_id, OLD.stage_id, NEW.stage_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tasks_log_stage_change ON tasks;
CREATE TRIGGER tasks_log_stage_change
  BEFORE UPDATE OF stage_id ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION log_task_stage_change();

-- ---- task_activity (histórico legível da tarefa, item 26 do pedido) ---------
CREATE TABLE IF NOT EXISTS task_activity (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id    uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id),
  user_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  type       text NOT NULL,
  title      text NOT NULL,
  detail     text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_task_activity_task ON task_activity(task_id);

ALTER TABLE task_activity ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS task_activity_select ON task_activity;
CREATE POLICY task_activity_select ON task_activity FOR SELECT
  USING (is_account_member(account_id) AND has_permission('operational', 'tasks', 'view_tasks'));
DROP POLICY IF EXISTS task_activity_insert ON task_activity;
CREATE POLICY task_activity_insert ON task_activity FOR INSERT
  WITH CHECK (is_account_member(account_id));

-- Log de criação.
CREATE OR REPLACE FUNCTION log_task_created()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO task_activity (task_id, account_id, user_id, type, title)
  VALUES (NEW.id, NEW.account_id, auth.uid(), 'created', 'Tarefa criada');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tasks_log_created ON tasks;
CREATE TRIGGER tasks_log_created
  AFTER INSERT ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION log_task_created();

-- Log genérico de mudança de campos — cobre responsável, setor, etapa,
-- prazo, prioridade, urgência e conclusão/reabertura automaticamente, sem
-- depender de nenhuma tela lembrar de chamar isso (ao contrário de
-- deal_activities, que só é escrito manualmente em 2 pontos do app).
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
      format('De "%s" para "%s"', COALESCE(old_stage_name, '—'), COALESCE(new_stage_name, '—')));
  END IF;

  IF NEW.assignee_id IS DISTINCT FROM OLD.assignee_id THEN
    SELECT full_name INTO old_assignee_name FROM profiles WHERE id = OLD.assignee_id;
    SELECT full_name INTO new_assignee_name FROM profiles WHERE id = NEW.assignee_id;
    INSERT INTO task_activity (task_id, account_id, user_id, type, title, detail)
    VALUES (NEW.id, NEW.account_id, auth.uid(), 'assignee_changed', 'Responsável alterado',
      format('De "%s" para "%s"', COALESCE(old_assignee_name, '—'), COALESCE(new_assignee_name, '—')));
  END IF;

  IF NEW.sector_id IS DISTINCT FROM OLD.sector_id THEN
    SELECT name INTO old_sector_name FROM sectors WHERE id = OLD.sector_id;
    SELECT name INTO new_sector_name FROM sectors WHERE id = NEW.sector_id;
    INSERT INTO task_activity (task_id, account_id, user_id, type, title, detail)
    VALUES (NEW.id, NEW.account_id, auth.uid(), 'sector_changed', 'Setor alterado',
      format('De "%s" para "%s"', COALESCE(old_sector_name, '—'), COALESCE(new_sector_name, '—')));
  END IF;

  IF NEW.due_date IS DISTINCT FROM OLD.due_date THEN
    INSERT INTO task_activity (task_id, account_id, user_id, type, title, detail)
    VALUES (NEW.id, NEW.account_id, auth.uid(), 'due_date_changed', 'Prazo alterado',
      format('De %s para %s', COALESCE(OLD.due_date::text, '—'), COALESCE(NEW.due_date::text, '—')));
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

DROP TRIGGER IF EXISTS tasks_log_changes ON tasks;
CREATE TRIGGER tasks_log_changes
  AFTER UPDATE ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION log_task_changes();

-- Comentário/checklist/subtarefa também geram entrada no histórico.
CREATE OR REPLACE FUNCTION log_task_comment_activity()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO task_activity (task_id, account_id, user_id, type, title)
  VALUES (NEW.task_id, NEW.account_id, auth.uid(), 'comment', 'Novo comentário');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS task_comments_log_activity ON task_comments;
CREATE TRIGGER task_comments_log_activity
  AFTER INSERT ON task_comments
  FOR EACH ROW
  EXECUTE FUNCTION log_task_comment_activity();

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

DROP TRIGGER IF EXISTS task_checklist_items_log_activity ON task_checklist_items;
CREATE TRIGGER task_checklist_items_log_activity
  AFTER INSERT OR UPDATE OF done ON task_checklist_items
  FOR EACH ROW
  EXECUTE FUNCTION log_task_checklist_activity();

CREATE OR REPLACE FUNCTION log_subtask_created_activity()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.parent_task_id IS NOT NULL THEN
    INSERT INTO task_activity (task_id, account_id, user_id, type, title, detail)
    VALUES (NEW.parent_task_id, NEW.account_id, auth.uid(), 'subtask', 'Subtarefa adicionada', NEW.title);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tasks_log_subtask_created ON tasks;
CREATE TRIGGER tasks_log_subtask_created
  AFTER INSERT OR UPDATE OF parent_task_id ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION log_subtask_created_activity();
