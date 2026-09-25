-- ============================================================
-- 089_task_number.sql — Codigo curto da tarefa (T-0042)
--
-- Cada tarefa ganha um numero sequencial POR CONTA (nunca reaproveitado,
-- mesmo se a tarefa for excluida, pois usa contador proprio e nao max+1).
-- E so um identificador para o time citar e buscar tarefas; nao tem
-- relacao com valores nem com o Financeiro.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS task_number int;

CREATE TABLE IF NOT EXISTS task_counters (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  last_number int NOT NULL DEFAULT 0
);
ALTER TABLE task_counters ENABLE ROW LEVEL SECURITY;
-- Sem policies: so as funcoes SECURITY DEFINER abaixo tocam nesta tabela.

CREATE OR REPLACE FUNCTION assign_task_number()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_next int;
BEGIN
  IF NEW.task_number IS NOT NULL THEN
    RETURN NEW;
  END IF;
  INSERT INTO task_counters (account_id, last_number)
  VALUES (NEW.account_id, 1)
  ON CONFLICT (account_id) DO UPDATE SET last_number = task_counters.last_number + 1
  RETURNING last_number INTO v_next;
  NEW.task_number := v_next;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tasks_assign_number ON tasks;
CREATE TRIGGER tasks_assign_number
  BEFORE INSERT ON tasks
  FOR EACH ROW EXECUTE FUNCTION assign_task_number();

-- Backfill: numera as tarefas existentes por ordem de criacao e ajusta o contador.
WITH numbered AS (
  SELECT id, row_number() OVER (PARTITION BY account_id ORDER BY created_at, id) AS n
  FROM tasks
  WHERE task_number IS NULL
)
UPDATE tasks t SET task_number = numbered.n + COALESCE(
  (SELECT last_number FROM task_counters c WHERE c.account_id = t.account_id), 0)
FROM numbered WHERE t.id = numbered.id;

INSERT INTO task_counters (account_id, last_number)
SELECT account_id, max(task_number) FROM tasks WHERE task_number IS NOT NULL GROUP BY account_id
ON CONFLICT (account_id) DO UPDATE SET last_number = GREATEST(task_counters.last_number, EXCLUDED.last_number);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_account_number ON tasks(account_id, task_number);
