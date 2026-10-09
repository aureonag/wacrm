-- ============================================================
-- 153_security_function_grants.sql — retira execução pública das funções
-- SECURITY DEFINER (achado F03 do suplemento + M1 da revisão, 2026-10-08).
--
-- Causa
--   O Supabase concede EXECUTE direto a anon/authenticated/service_role em
--   toda função nova do schema public (default privileges). Os
--   `REVOKE ... FROM PUBLIC` das migrations (022, 036, ...) não removem esses
--   grants diretos — por isso o banco divergia das migrations
--   (anon_execute = true). Funções como merge_duplicate_contacts() e
--   merge_duplicate_conversations() (UPDATE/DELETE entre contas, sem checar o
--   chamador) ficavam chamáveis sem login.
--
-- Correção (em duas camadas, sem mexer em default privileges)
--   1) TODA função SECURITY DEFINER de public perde EXECUTE de PUBLIC e anon,
--      exceto uma lista curta que precisa responder a visitantes ou é só um
--      predicado que devolve false sem sessão.
--   2) Funções puramente internas (chamadas só pelo servidor com service_role
--      ou por triggers) também perdem EXECUTE de authenticated.
--   service_role mantém tudo. Triggers e funções chamadas por triggers
--   continuam funcionando (rodam com o dono, postgres).
--
-- Idempotente — seguro para rodar várias vezes.
-- ============================================================

DO $$
DECLARE
  r record;
  -- Mantêm anon: a página pública de convite e predicados que são só leitura
  -- e devolvem false/vazio sem sessão (usados por policies avaliadas para anon).
  keep_anon text[] := ARRAY[
    'peek_invitation',
    'is_account_member', 'has_permission', 'has_environment_access',
    'get_my_permissions', 'can_access_chat_channel',
    'aff_is_staff', 'aff_my_client_ids', 'aff_my_affiliate_id'
  ];
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prokind = 'f'
       AND p.prosecdef
       AND p.proname <> ALL (keep_anon)
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.sig);
  END LOOP;
END $$;

DO $$
DECLARE
  r record;
  internal_only text[] := ARRAY[
    '_bcast_bump', '_bcast_cols_for_status', 'recompute_broadcast_counts',
    'claim_ai_reply_slot',
    'merge_duplicate_contacts', 'merge_duplicate_conversations',
    'record_webhook_failure',
    'increment_flow_execution_count', 'increment_automation_execution_count',
    'bump_conversation_on_inbound',
    'aff_portal_ready',
    'spawn_recurring_tasks', 'next_recurrence_date', 'notify_due_dates',
    'create_kickoff_task_for_deal',
    'emit_task_notification', 'emit_task_notification_audience',
    'notification_enabled'
  ];
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prokind = 'f'
       AND p.proname = ANY (internal_only)
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;

-- Validação manual (SQL editor):
--   SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname='public' AND p.prosecdef ORDER BY 1;
--   -> merge_duplicate_* / _bcast_bump / claim_ai_reply_slot: anon=false, authenticated=false.
--   Depois: login, inbox, enviar mensagem, criar tarefa, assinar contrato de teste seguem ok.
