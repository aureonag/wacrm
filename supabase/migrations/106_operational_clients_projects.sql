-- ============================================================
-- 106_operational_clients_projects.sql — Clientes e Projetos de Operacional
--
-- Escopo
--   Cadastro de CLIENTES da operação (independente de contrato assinado),
--   PROJETOS de cada cliente (as frentes: Tráfego, Mídia, Social, E-mail Mkt…)
--   e o campo `tasks.project_id` para ligar cada tarefa a um projeto.
--   Fluxo igual ao do Runrun: cliente → projetos → tarefas.
--
-- Acesso
--   Ver: quem pode ver tarefas ('operational','tasks','view_tasks').
--   Criar/editar/apagar clientes e projetos: quem edita quadros
--   ('operational','tasks','edit_boards') — é estrutura, como um quadro.
--   Usa SOMENTE as funções e permissões que já existem; não cria nem altera
--   permissão nenhuma.
--
-- NÃO mexe em
--   nenhuma tabela, função ou policy existente (só acrescenta a coluna
--   `project_id`, opcional, em `tasks`).
--
-- Idempotente — seguro para rodar várias vezes.
-- ============================================================

-- ---- clientes da operação ---------------------------------------------------
CREATE TABLE IF NOT EXISTS ops_clients (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id),
  name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  code        text,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  -- Ligações opcionais: o cliente pode existir sem contrato / sem contato.
  contract_id uuid REFERENCES deal_contracts(id) ON DELETE SET NULL,
  contact_id  uuid REFERENCES contacts(id) ON DELETE SET NULL,
  notes       text,
  -- Origem da importação do Runrun (evita duplicar se a carga rodar de novo).
  runrun_id   bigint,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ops_clients_name ON ops_clients(account_id, lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS idx_ops_clients_runrun ON ops_clients(account_id, runrun_id) WHERE runrun_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ops_clients_account ON ops_clients(account_id, status);

-- ---- projetos de cada cliente -----------------------------------------------
CREATE TABLE IF NOT EXISTS ops_projects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id),
  client_id   uuid NOT NULL REFERENCES ops_clients(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  description text,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  start_date  date,
  due_date    date,
  runrun_id   bigint,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (due_date IS NULL OR start_date IS NULL OR due_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_ops_projects_client ON ops_projects(client_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ops_projects_runrun ON ops_projects(account_id, runrun_id) WHERE runrun_id IS NOT NULL;

-- ---- tarefa → projeto (opcional) ----------------------------------------------
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES ops_projects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);

-- ---- RLS --------------------------------------------------------------------------
ALTER TABLE ops_clients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ops_clients_select ON ops_clients;
CREATE POLICY ops_clients_select ON ops_clients FOR SELECT
  USING (is_account_member(account_id) AND has_permission('operational', 'tasks', 'view_tasks'));
DROP POLICY IF EXISTS ops_clients_insert ON ops_clients;
CREATE POLICY ops_clients_insert ON ops_clients FOR INSERT
  WITH CHECK (is_account_member(account_id) AND has_permission('operational', 'tasks', 'edit_boards'));
DROP POLICY IF EXISTS ops_clients_update ON ops_clients;
CREATE POLICY ops_clients_update ON ops_clients FOR UPDATE
  USING (is_account_member(account_id) AND has_permission('operational', 'tasks', 'edit_boards'));
DROP POLICY IF EXISTS ops_clients_delete ON ops_clients;
CREATE POLICY ops_clients_delete ON ops_clients FOR DELETE
  USING (is_account_member(account_id) AND has_permission('operational', 'tasks', 'edit_boards'));

ALTER TABLE ops_projects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ops_projects_select ON ops_projects;
CREATE POLICY ops_projects_select ON ops_projects FOR SELECT
  USING (is_account_member(account_id) AND has_permission('operational', 'tasks', 'view_tasks'));
DROP POLICY IF EXISTS ops_projects_insert ON ops_projects;
CREATE POLICY ops_projects_insert ON ops_projects FOR INSERT
  WITH CHECK (is_account_member(account_id) AND has_permission('operational', 'tasks', 'edit_boards'));
DROP POLICY IF EXISTS ops_projects_update ON ops_projects;
CREATE POLICY ops_projects_update ON ops_projects FOR UPDATE
  USING (is_account_member(account_id) AND has_permission('operational', 'tasks', 'edit_boards'));
DROP POLICY IF EXISTS ops_projects_delete ON ops_projects;
CREATE POLICY ops_projects_delete ON ops_projects FOR DELETE
  USING (is_account_member(account_id) AND has_permission('operational', 'tasks', 'edit_boards'));

-- ---- updated_at ---------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ops_clients', 'ops_projects']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON %I', t);
    EXECUTE format('CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I
                    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()', t);
  END LOOP;
END $$;
