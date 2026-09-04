-- ETAPA 2, Fase 5 — Recorrencia simples de tarefas (sem RFC 5545, por
-- pedido explicito): semanal, mensal em um dia fixo, ou mensal no
-- primeiro dia util. A tarefa "modelo" (template_task_id) carrega a
-- regra; um job diario (pg_cron -> spawn_recurring_tasks()) materializa
-- a proxima ocorrencia como uma tarefa nova na primeira etapa do quadro
-- e avanca next_run_at para a data seguinte. A primeira ocorrencia (o
-- next_run_at inicial) e calculada no cliente/API por
-- src/lib/tasks/recurrence.ts (computeInitialNextRunAt) usando a MESMA
-- logica de avanco implementada aqui em next_recurrence_date().
--
-- tasks.recurrence_rule_id NAO aponta para a regra na tarefa modelo (essa
-- direcao ja existe via task_recurrence_rules.template_task_id) -- ele e
-- setado nas tarefas GERADAS por uma regra, para permitir identificar
-- "esta tarefa nasceu de uma recorrencia" na UI.

CREATE TABLE IF NOT EXISTS task_recurrence_rules (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id        uuid NOT NULL REFERENCES accounts(id),
  template_task_id  uuid NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
  rule_type         text NOT NULL CHECK (rule_type IN ('weekly', 'monthly_day', 'monthly_first_business_day')),
  weekday           int CHECK (weekday BETWEEN 0 AND 6),
  day_of_month      int CHECK (day_of_month BETWEEN 1 AND 31),
  next_run_at       date NOT NULL,
  active            boolean NOT NULL DEFAULT true,
  created_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_recurrence_rules_due
  ON task_recurrence_rules(next_run_at) WHERE active;

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence_rule_id uuid REFERENCES task_recurrence_rules(id) ON DELETE SET NULL;

ALTER TABLE task_recurrence_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS task_recurrence_rules_select ON task_recurrence_rules;
CREATE POLICY task_recurrence_rules_select ON task_recurrence_rules FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS task_recurrence_rules_insert ON task_recurrence_rules;
CREATE POLICY task_recurrence_rules_insert ON task_recurrence_rules FOR INSERT
  WITH CHECK (
    is_account_member(account_id, 'agent')
    AND has_permission('operational', 'tasks', 'edit_tasks')
  );

DROP POLICY IF EXISTS task_recurrence_rules_update ON task_recurrence_rules;
CREATE POLICY task_recurrence_rules_update ON task_recurrence_rules FOR UPDATE
  USING (
    is_account_member(account_id, 'agent')
    AND has_permission('operational', 'tasks', 'edit_tasks')
  );

DROP POLICY IF EXISTS task_recurrence_rules_delete ON task_recurrence_rules;
CREATE POLICY task_recurrence_rules_delete ON task_recurrence_rules FOR DELETE
  USING (
    is_account_member(account_id, 'agent')
    AND has_permission('operational', 'tasks', 'edit_tasks')
  );

-- Single source of truth for "what's the next date after this one", used
-- by spawn_recurring_tasks() below to advance a rule on every firing.
CREATE OR REPLACE FUNCTION next_recurrence_date(
  p_rule_type text, p_weekday int, p_day_of_month int, p_from date
) RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_rule_type
    WHEN 'weekly' THEN p_from + 7
    WHEN 'monthly_day' THEN LEAST(
      (date_trunc('month', p_from) + interval '1 month')::date + (p_day_of_month - 1),
      (date_trunc('month', p_from) + interval '2 months' - interval '1 day')::date
    )
    WHEN 'monthly_first_business_day' THEN (
      SELECT d::date FROM generate_series(
        (date_trunc('month', p_from) + interval '1 month')::date,
        (date_trunc('month', p_from) + interval '1 month' + interval '6 days')::date,
        interval '1 day'
      ) AS d
      WHERE extract(isodow FROM d) < 6
      ORDER BY d LIMIT 1
    )
  END;
$$;

-- Materializes every due occurrence as a new task in the first stage of
-- its board, logs a "created" activity row (the generic tasks trigger
-- only fires on UPDATE, not INSERT, so this mirrors what the app-code
-- create-task path does), and advances each rule's next_run_at.
-- SECURITY DEFINER because pg_cron invokes it with no request-scoped
-- auth.uid()/RLS context — same reasoning as the log_* trigger functions.
CREATE OR REPLACE FUNCTION spawn_recurring_tasks()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  new_task_id uuid;
  first_stage_id uuid;
BEGIN
  FOR r IN
    SELECT rr.id AS rule_id, rr.rule_type, rr.weekday, rr.day_of_month, rr.next_run_at,
           t.account_id, t.board_id, t.title, t.contact_id, t.sector_id, t.assignee_id,
           t.priority, t.briefing, t.estimated_minutes, t.created_by
    FROM task_recurrence_rules rr
    JOIN tasks t ON t.id = rr.template_task_id
    WHERE rr.active AND rr.next_run_at <= current_date
  LOOP
    SELECT id INTO first_stage_id FROM board_stages WHERE board_id = r.board_id ORDER BY position ASC LIMIT 1;
    IF first_stage_id IS NULL THEN
      CONTINUE; -- board has no stages (shouldn't happen) -- skip rather than fail the whole batch
    END IF;

    INSERT INTO tasks (
      account_id, board_id, stage_id, title, contact_id, sector_id, assignee_id,
      priority, briefing, estimated_minutes, created_by, recurrence_rule_id
    ) VALUES (
      r.account_id, r.board_id, first_stage_id, r.title, r.contact_id, r.sector_id, r.assignee_id,
      r.priority, r.briefing, r.estimated_minutes, r.created_by, r.rule_id
    )
    RETURNING id INTO new_task_id;

    INSERT INTO task_activity (task_id, account_id, user_id, type, title)
    VALUES (new_task_id, r.account_id, r.created_by, 'created', 'Tarefa criada por recorrencia');

    UPDATE task_recurrence_rules
    SET next_run_at = next_recurrence_date(r.rule_type, r.weekday, r.day_of_month, r.next_run_at)
    WHERE id = r.rule_id;
  END LOOP;
END;
$$;

-- Daily materialization job. Supabase projects sometimes require pg_cron
-- to be turned on from the dashboard (Database -> Extensions) rather
-- than via SQL -- if that's the case here, this block is a no-op and the
-- schedule step below is skipped too (both re-checked, harmless to
-- re-run once the extension is enabled).
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
EXCEPTION WHEN insufficient_privilege OR feature_not_supported THEN
  RAISE NOTICE 'pg_cron could not be enabled via SQL -- enable it under Database > Extensions, then re-run the DO block below.';
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'spawn-recurring-tasks';
    PERFORM cron.schedule('spawn-recurring-tasks', '0 6 * * *', 'SELECT spawn_recurring_tasks();');
  END IF;
END $$;
