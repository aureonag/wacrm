-- Afiliados → Nuvemshop (app "Aureon", id 50395 no Portal de Parceiros).
--
-- 1) aff_integrations: cada loja que instalou o app. O token (que não expira)
--    fica criptografado (AES-256-GCM, mesma ENCRYPTION_KEY do WhatsApp) e só o
--    servidor lê. `client_id` fica nulo quando a loja instala pelo painel da
--    própria Nuvemshop (sem passar pelo CRM): a equipe Aureon vincula depois ao
--    cliente certo.
-- 2) aff_membership_coupons: o cupom que o CRM criou na loja para cada
--    participante aprovado (e o resultado da última sincronização).
-- 3) aff_orders ganha o que é preciso para receber pedidos reais: a loja de
--    origem, o cupom usado, a data do pagamento e unicidade por pedido (os
--    webhooks chegam repetidos e fora de ordem; o upsert precisa ser seguro).
--
-- Sem nenhum dado pessoal de comprador: guardamos só id, valor, situação e cupom.

CREATE TABLE IF NOT EXISTS aff_integrations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         uuid REFERENCES aff_clients(id) ON DELETE SET NULL,
  platform          text NOT NULL CHECK (platform IN ('nuvemshop')),
  external_store_id text NOT NULL,
  store_name        text,
  store_url         text,
  token_encrypted   text NOT NULL,
  scopes            text,
  status            text NOT NULL DEFAULT 'connected' CHECK (status IN ('connected', 'error', 'revoked')),
  last_error        text,
  webhooks_ok       boolean NOT NULL DEFAULT false,
  installed_at      timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, external_store_id)
);
-- Um cliente tem no máximo uma loja Nuvemshop em uso.
CREATE UNIQUE INDEX IF NOT EXISTS idx_aff_integrations_client_platform
  ON aff_integrations(client_id, platform)
  WHERE client_id IS NOT NULL AND status <> 'revoked';

CREATE TABLE IF NOT EXISTS aff_membership_coupons (
  membership_id      uuid PRIMARY KEY REFERENCES aff_memberships(id) ON DELETE CASCADE,
  integration_id     uuid NOT NULL REFERENCES aff_integrations(id) ON DELETE CASCADE,
  external_coupon_id text,
  state              text NOT NULL CHECK (state IN ('synced', 'error', 'removed')),
  last_error         text,
  synced_at          timestamptz,
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_aff_membership_coupons_integration ON aff_membership_coupons(integration_id);

ALTER TABLE aff_orders
  ADD COLUMN IF NOT EXISTS integration_id uuid REFERENCES aff_integrations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS coupon_code    text,
  ADD COLUMN IF NOT EXISTS paid_at        timestamptz;

-- Um pedido da loja = uma linha. NULLs não colidem (pedidos de amostra sem id externo).
CREATE UNIQUE INDEX IF NOT EXISTS idx_aff_orders_client_external
  ON aff_orders(client_id, external_id);

-- RLS ligada e SEM policy: só as rotas do servidor (service role) leem e escrevem
-- aqui; o token nunca chega ao navegador.
ALTER TABLE aff_integrations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE aff_membership_coupons ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON aff_integrations       FROM anon, authenticated;
REVOKE ALL ON aff_membership_coupons FROM anon, authenticated;

DROP TRIGGER IF EXISTS set_updated_at ON aff_integrations;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON aff_integrations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS set_updated_at ON aff_membership_coupons;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON aff_membership_coupons
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
