-- ============================================================
-- 100_affiliates_foundation.sql — módulo Afiliados (SaaS vendido pela Aureon)
--
-- Escopo
--   Tabelas `aff_*` para clientes (lojas), usuários da loja, afiliados,
--   campanhas, participações, pedidos, comissões e auditoria.
--
-- NÃO mexe em
--   permissions / roles / role_permissions / user_permission_overrides,
--   profiles, accounts nem em qualquer função de permissão do CRM.
--   (O sistema de permissões está sendo reorganizado em outra frente.)
--
-- Isolamento
--   Clientes e afiliados são usuários do Supabase Auth SEM linha em
--   `profiles`, portanto is_account_member() é falso para eles e eles não
--   alcançam nenhuma tabela do CRM. Veja a migration 101 (bootstrap).
--
-- Acesso do time (provisório)
--   aff_is_staff() = owner/admin da conta do CRM. Quando as permissões
--   forem reorganizadas, troque SOMENTE o corpo dessa função (ex.:
--   has_permission('afiliados', ...)); nenhuma policy precisa mudar.
--
-- Escrita de cliente/afiliado
--   Policies dão apenas SELECT a clientes e afiliados. Escritas deles
--   (enviar nota, registrar pagamento, inscrever-se) passam por rotas de
--   API do servidor com service_role e validação própria.
--
-- Idempotente — seguro para rodar várias vezes.
-- ============================================================

-- ---- helpers --------------------------------------------------------------

-- Time Aureon (provisório): owner ou admin de qualquer conta do CRM.
CREATE OR REPLACE FUNCTION public.aff_is_staff()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles p
     WHERE p.user_id = auth.uid()
       AND p.account_role IN ('owner', 'admin')
  );
$$;

-- ---- clientes (lojas que contratam o SaaS) --------------------------------
CREATE TABLE IF NOT EXISTS aff_clients (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  legal_name    text,
  cnpj          text,
  platform      text CHECK (platform IN ('nuvemshop', 'tray', 'outra')),
  contact_name  text,
  contact_email text,
  contact_phone text,
  notes         text,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'removed')),
  suspended_at  timestamptz,
  removed_at    timestamptz,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_aff_clients_cnpj ON aff_clients(cnpj)
  WHERE cnpj IS NOT NULL AND status <> 'removed';

-- ---- usuários da loja (vários por cliente, permissões configuráveis) -------
-- `role` é um atalho; `permissions` guarda o ajuste fino por pessoa no
-- formato {"modulo": ["view","edit"]}. Interpretado pelo app, não pelo RLS.
CREATE TABLE IF NOT EXISTS aff_client_users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid NOT NULL REFERENCES aff_clients(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  email       text NOT NULL,
  role        text NOT NULL DEFAULT 'viewer' CHECK (role IN ('owner', 'manager', 'finance', 'viewer')),
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'disabled')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_aff_client_users_user ON aff_client_users(user_id);

-- ---- afiliados (pessoa única; vínculos por loja/campanha ficam em memberships)
CREATE TABLE IF NOT EXISTS aff_affiliates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  name          text NOT NULL,
  email         text NOT NULL,
  phone         text,
  instagram     text,
  city          text,
  state         text,
  pix_key_type  text CHECK (pix_key_type IN ('cpf', 'cnpj', 'email', 'phone', 'random')),
  pix_key       text,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_aff_affiliates_email ON aff_affiliates(lower(email));

-- ---- campanhas -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS aff_campaigns (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL REFERENCES aff_clients(id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  description   text NOT NULL,
  policy        text NOT NULL,
  discount_type text NOT NULL CHECK (discount_type IN ('PERCENTAGE', 'CURRENCY')),
  discount      numeric NOT NULL CHECK (discount > 0),
  frequency     text NOT NULL CHECK (frequency IN ('RECURRENT', 'PERIODIC')),
  start_date    date NOT NULL,
  end_date      date,
  -- [{month:'2026-10', type:'PIX'|'GIFTBACK'|'OTHER', value:number|null, description:text}]
  rewards       jsonb NOT NULL DEFAULT '[]'::jsonb,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  revision      integer NOT NULL DEFAULT 1,
  history       jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_aff_campaigns_client ON aff_campaigns(client_id);

-- ---- participação do afiliado em uma campanha (gera o cupom) -------------------
CREATE TABLE IF NOT EXISTS aff_memberships (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id          uuid NOT NULL REFERENCES aff_clients(id) ON DELETE CASCADE,
  campaign_id        uuid NOT NULL REFERENCES aff_campaigns(id) ON DELETE CASCADE,
  affiliate_id       uuid NOT NULL REFERENCES aff_affiliates(id) ON DELETE CASCADE,
  code               text NOT NULL CHECK (code ~ '^[A-Z0-9]{3,30}$'),
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'inactive')),
  accepted_revision  integer,
  accepted_policy    text,
  accepted_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, affiliate_id),
  UNIQUE (client_id, code)
);
CREATE INDEX IF NOT EXISTS idx_aff_memberships_affiliate ON aff_memberships(affiliate_id);

-- ---- pedidos atribuídos (por enquanto amostras; integração vem depois) ------
CREATE TABLE IF NOT EXISTS aff_orders (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL REFERENCES aff_clients(id) ON DELETE CASCADE,
  membership_id uuid NOT NULL REFERENCES aff_memberships(id) ON DELETE CASCADE,
  affiliate_id  uuid NOT NULL REFERENCES aff_affiliates(id) ON DELETE CASCADE,
  external_id   text,
  total_cents   bigint NOT NULL CHECK (total_cents >= 0),
  status        text NOT NULL CHECK (status IN ('paid', 'cancelled', 'pending')),
  ordered_at    timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_aff_orders_client ON aff_orders(client_id);
CREATE INDEX IF NOT EXISTS idx_aff_orders_affiliate ON aff_orders(affiliate_id);

-- ---- comissões por afiliado/competência (nota fiscal + pagamento) -------------
-- Valores em centavos. Fluxo: awaiting_invoice → invoice_review → available
-- → paid_external (ou invoice_rejected → reenvio). Pagamento só com nota aprovada.
CREATE TABLE IF NOT EXISTS aff_commissions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           uuid NOT NULL REFERENCES aff_clients(id) ON DELETE CASCADE,
  affiliate_id        uuid NOT NULL REFERENCES aff_affiliates(id) ON DELETE CASCADE,
  period              text NOT NULL CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  gross_cents         bigint NOT NULL CHECK (gross_cents > 0),
  withholding_cents   bigint NOT NULL DEFAULT 0 CHECK (withholding_cents >= 0),
  status              text NOT NULL DEFAULT 'awaiting_invoice'
                      CHECK (status IN ('awaiting_invoice', 'invoice_review', 'invoice_rejected', 'available', 'paid_external')),
  invoice_number      text,
  invoice_issuer      text,
  invoice_recipient   text,
  invoice_value_cents bigint,
  invoice_status      text CHECK (invoice_status IN ('in_review', 'approved', 'rejected')),
  invoice_reason      text,
  invoice_sent_at     timestamptz,
  invoice_file_path   text,   -- caminho no storage privado
  invoice_file_name   text,
  invoice_file_mime   text,
  receipt_file_path   text,
  receipt_file_name   text,
  receipt_file_mime   text,
  payment_reference   text,
  paid_at             timestamptz,
  paid_by             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, affiliate_id, period),
  CHECK (status <> 'paid_external' OR (invoice_status = 'approved' AND paid_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_aff_commissions_affiliate ON aff_commissions(affiliate_id);

-- ---- auditoria --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS aff_audit (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid REFERENCES aff_clients(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_name    text,
  actor_kind    text CHECK (actor_kind IN ('staff', 'client', 'affiliate', 'system')),
  action        text NOT NULL,
  object_type   text,
  object_id     text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_aff_audit_client ON aff_audit(client_id, created_at DESC);

-- ---- triggers updated_at -----------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['aff_clients', 'aff_client_users', 'aff_affiliates',
                           'aff_campaigns', 'aff_memberships', 'aff_commissions']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_updated_at ON %I', t);
    EXECUTE format('CREATE TRIGGER set_updated_at BEFORE UPDATE ON %I
                    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()', t);
  END LOOP;
END $$;

-- ---- helpers de escopo (cliente e afiliado) -------------------------------------
-- Clientes cujo acesso está ativo para o usuário logado. Cliente suspenso ou
-- removido, ou usuário desativado, não enxerga nada.
CREATE OR REPLACE FUNCTION public.aff_my_client_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT cu.client_id
    FROM aff_client_users cu
    JOIN aff_clients c ON c.id = cu.client_id
   WHERE cu.user_id = auth.uid()
     AND cu.status = 'active'
     AND c.status = 'active';
$$;

-- Afiliado do usuário logado (se ativo).
CREATE OR REPLACE FUNCTION public.aff_my_affiliate_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT a.id FROM aff_affiliates a
   WHERE a.user_id = auth.uid() AND a.status = 'active'
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.aff_is_staff() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aff_my_client_ids() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aff_my_affiliate_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aff_is_staff() TO authenticated;
GRANT EXECUTE ON FUNCTION public.aff_my_client_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.aff_my_affiliate_id() TO authenticated;

-- ---- RLS ------------------------------------------------------------------------
ALTER TABLE aff_clients      ENABLE ROW LEVEL SECURITY;
ALTER TABLE aff_client_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE aff_affiliates   ENABLE ROW LEVEL SECURITY;
ALTER TABLE aff_campaigns    ENABLE ROW LEVEL SECURITY;
ALTER TABLE aff_memberships  ENABLE ROW LEVEL SECURITY;
ALTER TABLE aff_orders       ENABLE ROW LEVEL SECURITY;
ALTER TABLE aff_commissions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE aff_audit        ENABLE ROW LEVEL SECURITY;

-- Time: acesso total a todas as tabelas.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['aff_clients', 'aff_client_users', 'aff_affiliates', 'aff_campaigns',
                           'aff_memberships', 'aff_orders', 'aff_commissions', 'aff_audit']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_staff_all', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL USING (aff_is_staff()) WITH CHECK (aff_is_staff())',
                   t || '_staff_all', t);
  END LOOP;
END $$;

-- Cliente: lê somente o que pertence às suas lojas ativas.
DROP POLICY IF EXISTS aff_clients_client_select ON aff_clients;
CREATE POLICY aff_clients_client_select ON aff_clients FOR SELECT
  USING (id IN (SELECT aff_my_client_ids()));

DROP POLICY IF EXISTS aff_client_users_client_select ON aff_client_users;
CREATE POLICY aff_client_users_client_select ON aff_client_users FOR SELECT
  USING (client_id IN (SELECT aff_my_client_ids()));

DROP POLICY IF EXISTS aff_campaigns_client_select ON aff_campaigns;
CREATE POLICY aff_campaigns_client_select ON aff_campaigns FOR SELECT
  USING (client_id IN (SELECT aff_my_client_ids()));

DROP POLICY IF EXISTS aff_memberships_client_select ON aff_memberships;
CREATE POLICY aff_memberships_client_select ON aff_memberships FOR SELECT
  USING (client_id IN (SELECT aff_my_client_ids()));

DROP POLICY IF EXISTS aff_orders_client_select ON aff_orders;
CREATE POLICY aff_orders_client_select ON aff_orders FOR SELECT
  USING (client_id IN (SELECT aff_my_client_ids()));

DROP POLICY IF EXISTS aff_commissions_client_select ON aff_commissions;
CREATE POLICY aff_commissions_client_select ON aff_commissions FOR SELECT
  USING (client_id IN (SELECT aff_my_client_ids()));

DROP POLICY IF EXISTS aff_audit_client_select ON aff_audit;
CREATE POLICY aff_audit_client_select ON aff_audit FOR SELECT
  USING (client_id IN (SELECT aff_my_client_ids()));

-- Cliente vê os afiliados que participam das suas campanhas.
DROP POLICY IF EXISTS aff_affiliates_client_select ON aff_affiliates;
CREATE POLICY aff_affiliates_client_select ON aff_affiliates FOR SELECT
  USING (id IN (SELECT m.affiliate_id FROM aff_memberships m
                 WHERE m.client_id IN (SELECT aff_my_client_ids())));

-- Afiliado: somente os próprios dados.
DROP POLICY IF EXISTS aff_affiliates_self_select ON aff_affiliates;
CREATE POLICY aff_affiliates_self_select ON aff_affiliates FOR SELECT
  USING (id = aff_my_affiliate_id());

DROP POLICY IF EXISTS aff_memberships_self_select ON aff_memberships;
CREATE POLICY aff_memberships_self_select ON aff_memberships FOR SELECT
  USING (affiliate_id = aff_my_affiliate_id());

DROP POLICY IF EXISTS aff_orders_self_select ON aff_orders;
CREATE POLICY aff_orders_self_select ON aff_orders FOR SELECT
  USING (affiliate_id = aff_my_affiliate_id());

DROP POLICY IF EXISTS aff_commissions_self_select ON aff_commissions;
CREATE POLICY aff_commissions_self_select ON aff_commissions FOR SELECT
  USING (affiliate_id = aff_my_affiliate_id());

-- Afiliado vê as campanhas (e lojas) em que participa, de lojas ativas.
DROP POLICY IF EXISTS aff_campaigns_self_select ON aff_campaigns;
CREATE POLICY aff_campaigns_self_select ON aff_campaigns FOR SELECT
  USING (id IN (SELECT m.campaign_id FROM aff_memberships m WHERE m.affiliate_id = aff_my_affiliate_id())
         AND client_id IN (SELECT id FROM aff_clients WHERE status = 'active'));

DROP POLICY IF EXISTS aff_clients_affiliate_select ON aff_clients;
CREATE POLICY aff_clients_affiliate_select ON aff_clients FOR SELECT
  USING (status = 'active'
         AND id IN (SELECT m.client_id FROM aff_memberships m WHERE m.affiliate_id = aff_my_affiliate_id()));
