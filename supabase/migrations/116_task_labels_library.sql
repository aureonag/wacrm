-- Etiquetas (labels) das tarefas do Operacional, no modelo do Trello:
-- a etiqueta e criada UMA vez (nome + cor) numa biblioteca da conta e depois
-- so e marcada/desmarcada nas tarefas. Editar a etiqueta atualiza todas as
-- tarefas que a usam.
--
-- task_tags continua sendo a tabela "tarefa <-> etiqueta" (os cards, a busca,
-- o duplicar tarefa e as notificacoes seguem lendo label/color dela). Cada
-- linha agora aponta para a biblioteca por label_id, e label/color viram uma
-- copia mantida por trigger.

CREATE TABLE IF NOT EXISTS task_labels (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name       text NOT NULL DEFAULT '',
  color      text NOT NULL CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_task_labels_account ON task_labels(account_id);

ALTER TABLE task_labels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS task_labels_select ON task_labels;
CREATE POLICY task_labels_select ON task_labels FOR SELECT
  USING (is_account_member(account_id) AND has_permission('operational', 'tasks', 'view_tasks'));
DROP POLICY IF EXISTS task_labels_insert ON task_labels;
CREATE POLICY task_labels_insert ON task_labels FOR INSERT
  WITH CHECK (is_account_member(account_id) AND has_permission('operational', 'tasks', 'edit_tasks'));
DROP POLICY IF EXISTS task_labels_update ON task_labels;
CREATE POLICY task_labels_update ON task_labels FOR UPDATE
  USING (is_account_member(account_id) AND has_permission('operational', 'tasks', 'edit_tasks'))
  WITH CHECK (is_account_member(account_id) AND has_permission('operational', 'tasks', 'edit_tasks'));
DROP POLICY IF EXISTS task_labels_delete ON task_labels;
CREATE POLICY task_labels_delete ON task_labels FOR DELETE
  USING (is_account_member(account_id) AND has_permission('operational', 'tasks', 'edit_tasks'));

-- ---- task_tags passa a apontar para a biblioteca -----------------------------
ALTER TABLE task_tags ADD COLUMN IF NOT EXISTS label_id uuid REFERENCES task_labels(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_task_tags_label ON task_tags(label_id);

-- Converte as tags que ja existem: uma etiqueta por (conta, nome, cor).
INSERT INTO task_labels (account_id, name, color)
SELECT DISTINCT tt.account_id, tt.label,
       CASE WHEN tt.color ~ '^#[0-9A-Fa-f]{6}$' THEN upper(tt.color) ELSE '#6B7280' END
FROM task_tags tt
WHERE tt.label_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM task_labels l
    WHERE l.account_id = tt.account_id AND l.name = tt.label
      AND l.color = CASE WHEN tt.color ~ '^#[0-9A-Fa-f]{6}$' THEN upper(tt.color) ELSE '#6B7280' END
  );

UPDATE task_tags tt
SET label_id = l.id,
    color = l.color
FROM task_labels l
WHERE tt.label_id IS NULL
  AND l.account_id = tt.account_id AND l.name = tt.label
  AND l.color = CASE WHEN tt.color ~ '^#[0-9A-Fa-f]{6}$' THEN upper(tt.color) ELSE '#6B7280' END;

-- Uma etiqueta so pode estar uma vez na mesma tarefa.
CREATE UNIQUE INDEX IF NOT EXISTS uq_task_tags_task_label ON task_tags(task_id, label_id) WHERE label_id IS NOT NULL;

-- Ao ligar uma etiqueta a uma tarefa: confere a conta e copia nome/cor da biblioteca.
CREATE OR REPLACE FUNCTION task_tags_fill_from_label()
RETURNS TRIGGER AS $$
DECLARE
  v_name text;
  v_color text;
  v_account uuid;
BEGIN
  IF NEW.label_id IS NOT NULL THEN
    SELECT name, color, account_id INTO v_name, v_color, v_account FROM task_labels WHERE id = NEW.label_id;
    IF v_account IS NULL OR v_account <> NEW.account_id THEN
      RAISE EXCEPTION 'etiqueta invalida para esta conta';
    END IF;
    NEW.label := v_name;
    NEW.color := v_color;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS task_tags_fill_from_label ON task_tags;
CREATE TRIGGER task_tags_fill_from_label
  BEFORE INSERT ON task_tags
  FOR EACH ROW
  EXECUTE FUNCTION task_tags_fill_from_label();

-- Ao editar a etiqueta na biblioteca: atualiza a copia em todas as tarefas.
-- SECURITY DEFINER porque task_tags nao tem policy de UPDATE para o usuario.
CREATE OR REPLACE FUNCTION task_labels_propagate()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS task_labels_touch ON task_labels;
CREATE TRIGGER task_labels_touch
  BEFORE UPDATE ON task_labels
  FOR EACH ROW
  EXECUTE FUNCTION task_labels_propagate();

CREATE OR REPLACE FUNCTION task_labels_sync_tags()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE task_tags SET label = NEW.name, color = NEW.color WHERE label_id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS task_labels_sync_tags ON task_labels;
CREATE TRIGGER task_labels_sync_tags
  AFTER UPDATE OF name, color ON task_labels
  FOR EACH ROW
  EXECUTE FUNCTION task_labels_sync_tags();

-- Nao precisa ser chamavel direto pelo app.
REVOKE ALL ON FUNCTION task_labels_sync_tags() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION task_tags_fill_from_label() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION task_labels_propagate() FROM PUBLIC, anon, authenticated;
