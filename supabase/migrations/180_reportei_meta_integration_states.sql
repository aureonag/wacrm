-- Reportei / Meta: segmento do cliente, varias identidades Meta por empresa e estado
-- verificado de cada vinculo.
--
-- BANCO DE DESTINO: producao (projeto Supabase heesqqbjssficymgkdme, "wacrm"), o unico
-- banco do projeto; o servidor local tambem aponta para ele.
-- STATUS: APLICADA em 06/11/2026 no banco de producao, com autorizacao especifica do Allan.
--
-- IMPACTO
--   1. reportei_client_settings: tres colunas novas, todas NULL (= "nao configurado").
--      Nenhum relatorio ou tela existente depende delas.
--   2. meta_connections: a unicidade (account_id, user_id) vira (account_id, fb_user_id).
--      Passa a existir uma conexao por identidade Meta e empresa (varias identidades por
--      usuario do CRM; a mesma identidade nao se duplica). Uma tabela com 1 linha hoje
--      (conferido em 06/11/2026); o bloco DO abaixo aborta se houver identidades repetidas.
--      user_id continua sendo "quem do CRM autorizou" e nao e mais unico.
--      Colunas novas (NULL): tipo do token, escopos concedidos, fim do acesso aos dados e
--      ultima checagem.
--   3. ad_integrations: duas colunas novas (NULL) com o ultimo estado verificado do vinculo.
--   Nenhuma linha e apagada ou reescrita. Nao ha bloqueio longo (tabelas pequenas).
--
-- RECUPERACAO (desfazer; so se nao houver duas conexoes do mesmo usuario do CRM)
--   ALTER TABLE reportei_client_settings DROP COLUMN IF EXISTS segment, DROP COLUMN IF EXISTS lead_event, DROP COLUMN IF EXISTS purchase_event;
--   ALTER TABLE ad_integrations DROP COLUMN IF EXISTS last_verified_at, DROP COLUMN IF EXISTS last_state;
--   ALTER TABLE meta_connections DROP COLUMN IF EXISTS token_type, DROP COLUMN IF EXISTS granted_scopes, DROP COLUMN IF EXISTS data_access_expires_at, DROP COLUMN IF EXISTS last_checked_at;
--   DROP INDEX IF EXISTS meta_connections_account_identity_key;
--   ALTER TABLE meta_connections ADD CONSTRAINT meta_connections_account_id_user_id_key UNIQUE (account_id, user_id);

-- Segmento do cliente: configuracao explicita; NULL = nao configurado (nada de inferir
-- pelo nome nem de sortear). lead_event / purchase_event: evento canonico do cliente;
-- NULL = o padrao da integracao (lead e purchase, sem somar eventos sobrepostos).
ALTER TABLE reportei_client_settings
  ADD COLUMN IF NOT EXISTS segment text CHECK (segment IS NULL OR segment IN ('leads', 'ecommerce', 'mixed')),
  ADD COLUMN IF NOT EXISTS lead_event text CHECK (lead_event IS NULL OR char_length(lead_event) <= 100),
  ADD COLUMN IF NOT EXISTS purchase_event text CHECK (purchase_event IS NULL OR char_length(purchase_event) <= 100);

-- Uma conexao por identidade Meta (fb_user_id) e empresa.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM meta_connections GROUP BY account_id, fb_user_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'meta_connections tem a mesma identidade Meta repetida na mesma empresa; resolver antes de aplicar';
  END IF;
END $$;

ALTER TABLE meta_connections DROP CONSTRAINT IF EXISTS meta_connections_account_id_user_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS meta_connections_account_identity_key ON meta_connections (account_id, fb_user_id);

ALTER TABLE meta_connections
  ADD COLUMN IF NOT EXISTS token_type text,
  ADD COLUMN IF NOT EXISTS granted_scopes text[],
  ADD COLUMN IF NOT EXISTS data_access_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_checked_at timestamptz;

-- Ultimo estado verificado de cada vinculo (operational, no_delivery, no_access, token_invalid, failed).
ALTER TABLE ad_integrations
  ADD COLUMN IF NOT EXISTS last_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_state text;
