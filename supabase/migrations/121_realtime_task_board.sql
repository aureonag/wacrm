-- ============================================================
-- 121_realtime_task_board.sql — o quadro de tarefas atualiza ao vivo
--
-- Ate aqui `tasks` nao estava na publicacao supabase_realtime: quando alguem
-- movia/editava uma tarefa, os outros so viam depois de recarregar a tela.
-- Coloca na publicacao o que alimenta os cards (tarefas, etapas, tags,
-- membros, checklist, comentarios) e liga REPLICA IDENTITY FULL para que o
-- evento de UPDATE/DELETE traga task_id/board_id antigos — o cliente usa isso
-- para ignorar eventos de outros quadros e remover o card que saiu do quadro.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'tasks', 'board_stages', 'task_tags', 'task_participants',
    'task_checklist_items', 'task_comments'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I REPLICA IDENTITY FULL', t);
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;
