-- Reportei → Meta Ads com "Entrar com Facebook" (igual ao Reportei): cada pessoa
-- do time conecta o próprio Facebook e escolhe as contas de anúncio que já
-- acessa. O token de longa duração dela fica criptografado (AES-256-GCM, mesma
-- ENCRYPTION_KEY dos tokens do WhatsApp) e só o servidor consegue ler.

CREATE TABLE IF NOT EXISTS meta_connections (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES accounts(id),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  fb_user_id       text NOT NULL,
  fb_user_name     text,
  token_encrypted  text NOT NULL,
  token_expires_at timestamptz,
  status           text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'error', 'revoked')),
  last_error       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, user_id)
);

-- RLS ligada e SEM nenhuma policy: o navegador (anon/authenticated) não lê nem
-- escreve aqui; só as rotas do servidor, com a service role.
ALTER TABLE meta_connections ENABLE ROW LEVEL SECURITY;
-- Cinto e suspensório: sem nem o privilégio de tabela para anon/authenticated.
REVOKE ALL ON meta_connections FROM anon, authenticated;

DROP TRIGGER IF EXISTS set_updated_at ON meta_connections;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON meta_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Qual login deve ser usado para ler cada conta ligada a um cliente.
ALTER TABLE ad_integrations
  ADD COLUMN IF NOT EXISTS connection_id uuid REFERENCES meta_connections(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_ad_integrations_connection ON ad_integrations(connection_id);
