-- ============================================================
-- 117_fix_trigger_functions_after_grants.sql — conserta o que a 153 quebrou.
--
-- Sintoma
--   Em Operacional, salvar uma tarefa ("Salvar alteracoes"), aplicar etiqueta,
--   mexer no checklist, criar subtarefa... davam erro:
--     42501 permission denied for function emit_task_notification_audience
--
-- Causa
--   A 153 tirou EXECUTE de `authenticated` das funcoes internas
--   (emit_task_notification, emit_task_notification_audience,
--   notification_enabled, ...), assumindo que "triggers rodam com o dono
--   (postgres)". Isso so vale para funcao de trigger SECURITY DEFINER. As
--   funcoes de trigger de notificacao (notify_task_changes,
--   notify_task_tag_added, notify_checklist_change, notify_subtask_created...)
--   sao SECURITY INVOKER: rodam como o usuario logado, que perdeu o EXECUTE.
--
-- Correcao
--   Toda funcao de TRIGGER (public) que chama uma das funcoes internas e
--   ainda nao e SECURITY DEFINER passa a ser. A 153 continua valendo: o
--   cliente segue sem poder chamar as funcoes internas direto (nao da para
--   forjar notificacao pela API); so o trigger chama, com o dono.
--
-- Idempotente — seguro para rodar varias vezes.
-- ============================================================

DO $$
DECLARE
  r record;
  internal_re text :=
    '(emit_task_notification_audience|emit_task_notification|notification_enabled|'
    || 'create_kickoff_task_for_deal|bump_conversation_on_inbound|claim_ai_reply_slot|'
    || '_bcast_bump|_bcast_cols_for_status|recompute_broadcast_counts|record_webhook_failure|'
    || 'increment_flow_execution_count|increment_automation_execution_count|'
    || 'merge_duplicate_contacts|merge_duplicate_conversations|aff_portal_ready|'
    || 'spawn_recurring_tasks|next_recurrence_date|notify_due_dates)';
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prokind = 'f'
       AND p.prorettype = 'trigger'::regtype
       AND NOT p.prosecdef
       AND p.prosrc ~ internal_re
       -- a propria funcao interna nao entra (ela ja e/ficou como esta)
       AND p.proname !~ ('^' || internal_re || '$')
  LOOP
    EXECUTE format('ALTER FUNCTION %s SECURITY DEFINER SET search_path = public', r.sig);
    -- Funcao de trigger nao precisa ser chamavel por ninguem.
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    RAISE NOTICE 'trigger function now SECURITY DEFINER: %', r.proname;
  END LOOP;
END $$;

-- Conferencia (SQL editor): deve voltar ZERO linhas.
--   SELECT p.proname
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.prorettype = 'trigger'::regtype AND NOT p.prosecdef
--      AND p.prosrc ~ '(emit_task_notification|notification_enabled|create_kickoff_task_for_deal)';
