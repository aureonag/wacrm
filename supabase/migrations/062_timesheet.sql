-- ETAPA 2, Fase 4 — Timesheet: cronômetro persistente (não por página),
-- exatamente um timer ativo por usuário em toda a conta, lançamento
-- manual, histórico por pessoa/total, e tempo estimado vs. trabalhado.
--
-- Modelo: "pausar/retomar" não é uma máquina de estados própria — é só
-- fechar a entrada atual (ended_at) e abrir uma nova ligada à mesma
-- tarefa quando o usuário retoma. O "tempo total" é SUM(duration).
-- Isso funciona corretamente mesmo se o usuário fechar a aba ou atualizar
-- a página, porque o estado vive no banco, não em memória no cliente.
--
-- "Um timer ativo por usuário" é imposto no nível do banco por um índice
-- único parcial (WHERE ended_at IS NULL) — robusto a múltiplas abas ou
-- dispositivos, não depende do cliente se comportar.

INSERT INTO permissions (environment, module, action, label) VALUES
  ('operational', 'timesheet', 'view', 'Visualizar timesheet'),
  ('operational', 'timesheet', 'track', 'Cronometrar tempo'),
  ('operational', 'timesheet', 'log_manual', 'Lançar tempo manualmente'),
  ('operational', 'timesheet', 'edit_entries', 'Editar lançamentos de qualquer pessoa')
ON CONFLICT (environment, module, action) DO NOTHING;

CREATE TABLE IF NOT EXISTS timesheet_entries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES accounts(id),
  task_id      uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at   timestamptz NOT NULL DEFAULT now(),
  ended_at     timestamptz,
  is_manual    boolean NOT NULL DEFAULT false,
  description  text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT timesheet_entries_ended_after_started CHECK (ended_at IS NULL OR ended_at > started_at)
);

CREATE INDEX IF NOT EXISTS timesheet_entries_task_id_idx ON timesheet_entries(task_id);
CREATE INDEX IF NOT EXISTS timesheet_entries_user_id_idx ON timesheet_entries(user_id);

-- The enforcement: at most one open (ended_at IS NULL) row per user,
-- account-wide, regardless of which task or how many tabs/devices.
CREATE UNIQUE INDEX IF NOT EXISTS timesheet_entries_one_active_per_user
  ON timesheet_entries(user_id) WHERE ended_at IS NULL;

ALTER TABLE timesheet_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS timesheet_entries_select ON timesheet_entries;
CREATE POLICY timesheet_entries_select ON timesheet_entries FOR SELECT
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS timesheet_entries_insert ON timesheet_entries;
CREATE POLICY timesheet_entries_insert ON timesheet_entries FOR INSERT
  WITH CHECK (
    is_account_member(account_id, 'agent') AND (
      (user_id = auth.uid() AND NOT is_manual AND has_permission('operational', 'timesheet', 'track'))
      OR (user_id = auth.uid() AND is_manual AND has_permission('operational', 'timesheet', 'log_manual'))
      OR has_permission('operational', 'timesheet', 'edit_entries')
    )
  );

DROP POLICY IF EXISTS timesheet_entries_update ON timesheet_entries;
CREATE POLICY timesheet_entries_update ON timesheet_entries FOR UPDATE
  USING (
    is_account_member(account_id, 'agent') AND (
      (user_id = auth.uid() AND has_permission('operational', 'timesheet', 'track'))
      OR has_permission('operational', 'timesheet', 'edit_entries')
    )
  );

DROP POLICY IF EXISTS timesheet_entries_delete ON timesheet_entries;
CREATE POLICY timesheet_entries_delete ON timesheet_entries FOR DELETE
  USING (
    is_account_member(account_id, 'agent') AND (
      (user_id = auth.uid() AND has_permission('operational', 'timesheet', 'track'))
      OR has_permission('operational', 'timesheet', 'edit_entries')
    )
  );

-- Histórico de eventos (item 26 do pedido) — mesmo padrão de trigger dos
-- demais eventos de tarefa em 060_task_management_core.sql.
CREATE OR REPLACE FUNCTION log_timesheet_activity()
RETURNS TRIGGER AS $$
DECLARE
  minutes integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.is_manual THEN
      minutes := GREATEST(1, ROUND(EXTRACT(EPOCH FROM (NEW.ended_at - NEW.started_at)) / 60));
      INSERT INTO task_activity (task_id, account_id, user_id, type, title, detail)
      VALUES (NEW.task_id, NEW.account_id, NEW.user_id, 'timesheet', 'Tempo lançado manualmente', minutes || ' min');
    ELSE
      INSERT INTO task_activity (task_id, account_id, user_id, type, title)
      VALUES (NEW.task_id, NEW.account_id, NEW.user_id, 'timesheet', 'Cronômetro iniciado');
    END IF;
  ELSIF TG_OP = 'UPDATE' AND NEW.ended_at IS NOT NULL AND OLD.ended_at IS NULL THEN
    minutes := GREATEST(1, ROUND(EXTRACT(EPOCH FROM (NEW.ended_at - NEW.started_at)) / 60));
    INSERT INTO task_activity (task_id, account_id, user_id, type, title, detail)
    VALUES (NEW.task_id, NEW.account_id, NEW.user_id, 'timesheet', 'Cronômetro finalizado', minutes || ' min');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS timesheet_entries_log_activity ON timesheet_entries;
CREATE TRIGGER timesheet_entries_log_activity
  AFTER INSERT OR UPDATE OF ended_at ON timesheet_entries
  FOR EACH ROW
  EXECUTE FUNCTION log_timesheet_activity();
