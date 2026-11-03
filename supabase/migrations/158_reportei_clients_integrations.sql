-- Reportei (Operacional → Reportei): preferências de relatório de cada cliente
-- e as contas de anúncio ligadas a ele. O "projeto" do Reportei é o ops_clients
-- (migration 106); nada de ops_clients muda.
--
-- Nenhum token fica no banco: o acesso à Meta usa um usuário do sistema cujo
-- token vive só na variável de ambiente do servidor (META_ADS_ACCESS_TOKEN).

-- ---- preferências do cliente (passo 1 do "Novo cliente") ---------------------------
CREATE TABLE IF NOT EXISTS reportei_client_settings (
  client_id      uuid PRIMARY KEY REFERENCES ops_clients(id) ON DELETE CASCADE,
  account_id     uuid NOT NULL REFERENCES accounts(id),
  locale         text NOT NULL DEFAULT 'pt-BR' CHECK (locale IN ('pt-BR', 'en', 'es')),
  date_format    text NOT NULL DEFAULT 'DD/MM/YYYY' CHECK (date_format IN ('DD/MM/YYYY', 'MM/DD/YYYY')),
  decimal_format text NOT NULL DEFAULT 'comma' CHECK (decimal_format IN ('comma', 'dot')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reportei_client_settings_account ON reportei_client_settings(account_id);

-- ---- contas de anúncio ligadas a um cliente (passo 2) -------------------------------
CREATE TABLE IF NOT EXISTS ad_integrations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id            uuid NOT NULL REFERENCES accounts(id),
  client_id             uuid NOT NULL REFERENCES ops_clients(id) ON DELETE CASCADE,
  provider              text NOT NULL CHECK (provider IN ('meta_ads')),
  external_account_id   text NOT NULL CHECK (char_length(external_account_id) BETWEEN 1 AND 100),
  external_account_name text CHECK (external_account_name IS NULL OR char_length(external_account_name) <= 200),
  currency              text,
  timezone              text,
  status                text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'error', 'revoked')),
  last_error            text,
  last_synced_at        timestamptz,
  created_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, provider, external_account_id)
);
CREATE INDEX IF NOT EXISTS idx_ad_integrations_client ON ad_integrations(client_id);
CREATE INDEX IF NOT EXISTS idx_ad_integrations_account ON ad_integrations(account_id, provider);

-- ---- RLS (mesmo padrão de ops_clients) ----------------------------------------------
ALTER TABLE reportei_client_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reportei_client_settings_select ON reportei_client_settings;
CREATE POLICY reportei_client_settings_select ON reportei_client_settings FOR SELECT
  USING (is_account_member(account_id) AND has_permission('operational', 'tasks', 'view_tasks'));
DROP POLICY IF EXISTS reportei_client_settings_insert ON reportei_client_settings;
CREATE POLICY reportei_client_settings_insert ON reportei_client_settings FOR INSERT
  WITH CHECK (is_account_member(account_id) AND has_permission('operational', 'tasks', 'edit_boards'));
DROP POLICY IF EXISTS reportei_client_settings_update ON reportei_client_settings;
CREATE POLICY reportei_client_settings_update ON reportei_client_settings FOR UPDATE
  USING (is_account_member(account_id) AND has_permission('operational', 'tasks', 'edit_boards'));
DROP POLICY IF EXISTS reportei_client_settings_delete ON reportei_client_settings;
CREATE POLICY reportei_client_settings_delete ON reportei_client_settings FOR DELETE
  USING (is_account_member(account_id) AND has_permission('operational', 'tasks', 'edit_boards'));

ALTER TABLE ad_integrations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ad_integrations_select ON ad_integrations;
CREATE POLICY ad_integrations_select ON ad_integrations FOR SELECT
  USING (is_account_member(account_id) AND has_permission('operational', 'tasks', 'view_tasks'));
DROP POLICY IF EXISTS ad_integrations_insert ON ad_integrations;
CREATE POLICY ad_integrations_insert ON ad_integrations FOR INSERT
  WITH CHECK (is_account_member(account_id) AND has_permission('operational', 'tasks', 'edit_boards'));
DROP POLICY IF EXISTS ad_integrations_update ON ad_integrations;
CREATE POLICY ad_integrations_update ON ad_integrations FOR UPDATE
  USING (is_account_member(account_id) AND has_permission('operational', 'tasks', 'edit_boards'));
DROP POLICY IF EXISTS ad_integrations_delete ON ad_integrations;
CREATE POLICY ad_integrations_delete ON ad_integrations FOR DELETE
  USING (is_account_member(account_id) AND has_permission('operational', 'tasks', 'edit_boards'));

-- ---- updated_at ---------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['reportei_client_settings', 'ad_integrations']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON %I', t);
    EXECUTE format('CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I
                    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()', t);
  END LOOP;
END $$;
