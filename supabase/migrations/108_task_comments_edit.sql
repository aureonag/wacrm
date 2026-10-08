-- ============================================================
-- 108_task_comments_edit.sql — editar o próprio comentário da tarefa
--
-- Hoje a tabela só aceita criar e apagar comentários. Para editar:
--   1. coluna `edited_at` (quando o texto foi alterado pela última vez),
--      para a tela mostrar "(editado)";
--   2. política de UPDATE: só o AUTOR edita o próprio comentário, e só quem
--      pode comentar ('operational','tasks','comment');
--   3. trigger: o que muda é só o texto. Autor, tarefa, resposta e data de
--      criação ficam travados, e `edited_at` é carimbado pelo banco (hora do
--      servidor) sempre que o texto muda.
--
-- NÃO altera comentários existentes nem as políticas de leitura/criação/exclusão.
-- Usa só funções de permissão que já existem. Idempotente.
-- ============================================================

ALTER TABLE task_comments ADD COLUMN IF NOT EXISTS edited_at timestamptz;

DROP POLICY IF EXISTS task_comments_update ON task_comments;
CREATE POLICY task_comments_update ON task_comments FOR UPDATE
  USING (
    is_account_member(account_id)
    AND user_id = auth.uid()
    AND has_permission('operational', 'tasks', 'comment')
  )
  WITH CHECK (
    is_account_member(account_id)
    AND user_id = auth.uid()
    AND has_permission('operational', 'tasks', 'comment')
  );

CREATE OR REPLACE FUNCTION public.task_comments_on_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.task_id IS DISTINCT FROM OLD.task_id
     OR NEW.account_id IS DISTINCT FROM OLD.account_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.parent_comment_id IS DISTINCT FROM OLD.parent_comment_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'only the text of a comment can be edited';
  END IF;
  IF NEW.body IS DISTINCT FROM OLD.body THEN
    NEW.edited_at := now();
  ELSE
    NEW.edited_at := OLD.edited_at;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS task_comments_on_update ON task_comments;
CREATE TRIGGER task_comments_on_update
  BEFORE UPDATE ON task_comments
  FOR EACH ROW
  EXECUTE FUNCTION public.task_comments_on_update();
