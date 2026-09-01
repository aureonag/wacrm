-- ============================================================
-- 052_contracts.sql — Contrato feature: templates + deal contracts
--
-- Lets an agent attach one or more contracts to a deal: pick a
-- reusable text template, fill in the client's legal data, and send
-- it for signature either via Clicksign (real e-signature) or a
-- lightweight in-CRM "aceite virtual" (email OTP verification).
--
-- Design notes
--   - `deal_contracts.rendered_content` is a SNAPSHOT taken at send
--     time — editing the template afterward must never change what a
--     client already received or signed.
--   - The 5 legal fields (razao_social/cnpj/endereco/nome_representante/
--     cpf_representante) plus `client_email` live on the contract row,
--     not on `contacts` — they're specific to this contract instance
--     and shouldn't silently change if the contact record is edited.
--   - Clicksign-specific and virtual-specific columns are both nullable
--     on the same row (only one set is populated, based on
--     `signing_method`) rather than two separate tables — a contract
--     never changes method after creation, so there's no join cost to
--     pay for keeping them together.
--   - `deal_contract_events` is an append-only timeline (created/sent/
--     viewed/signed/...). Status alone can't show history, and
--     Clicksign webhooks can arrive out of order — overwriting a
--     single `viewed_at` column would lose information a log doesn't.
--
-- RLS
--   contract_templates: any member reads; admin+ writes (template
--     management is an account-settings action, same tier as pipeline
--     creation).
--   deal_contracts: any member reads; agent+ INSERT/UPDATE (same tier
--     as other deal-mutation actions); no client DELETE — cancelling
--     is a status update, not a delete, so history is never lost. The
--     public accept flow and the Clicksign webhook both write through
--     the service-role client, so no anon RLS policy is needed here.
--   deal_contract_events: any member reads; no client write policy —
--     rows are inserted by the API routes (agent-triggered events) or
--     the service-role webhook/RPC path (system events), never
--     directly by a client update.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ---- contract_templates -----------------------------------------------
CREATE TABLE IF NOT EXISTS contract_templates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name         text NOT NULL,
  content      text NOT NULL,
  is_active    boolean NOT NULL DEFAULT true,
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contract_templates_account
  ON contract_templates(account_id);

ALTER TABLE contract_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contract_templates_select ON contract_templates;
CREATE POLICY contract_templates_select ON contract_templates FOR SELECT
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS contract_templates_insert ON contract_templates;
CREATE POLICY contract_templates_insert ON contract_templates FOR INSERT
  WITH CHECK (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS contract_templates_update ON contract_templates;
CREATE POLICY contract_templates_update ON contract_templates FOR UPDATE
  USING (is_account_member(account_id, 'admin'));
DROP POLICY IF EXISTS contract_templates_delete ON contract_templates;
CREATE POLICY contract_templates_delete ON contract_templates FOR DELETE
  USING (is_account_member(account_id, 'admin'));

CREATE OR REPLACE FUNCTION public.update_contract_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS contract_templates_updated_at ON contract_templates;
CREATE TRIGGER contract_templates_updated_at
  BEFORE UPDATE ON contract_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.update_contract_templates_updated_at();

-- ---- deal_contracts -----------------------------------------------------
CREATE TABLE IF NOT EXISTS deal_contracts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id            uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  deal_id               uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  template_id           uuid REFERENCES contract_templates(id) ON DELETE SET NULL,

  -- Legal data — confirmed fields, entered by the agent before send.
  razao_social          text NOT NULL,
  cnpj                  text NOT NULL,
  endereco              text NOT NULL,
  nome_representante    text NOT NULL,
  cpf_representante     text NOT NULL,
  client_email          text NOT NULL,

  -- Snapshot of the template content with variables filled in, taken
  -- once at send time. NULL while status='draft'.
  rendered_content      text,

  signing_method        text NOT NULL CHECK (signing_method IN ('clicksign', 'virtual')),
  status                text NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft', 'sent', 'viewed', 'signed', 'declined', 'expired', 'cancelled')),

  -- Clicksign-specific — only populated when signing_method='clicksign'.
  clicksign_envelope_id text,
  clicksign_document_id text,
  clicksign_signer_id   text,
  clicksign_sign_url    text,
  signed_pdf_path       text,

  -- Virtual-acceptance-specific — only populated when signing_method='virtual'.
  token_hash            text,
  otp_code_hash         text,
  otp_expires_at        timestamptz,
  otp_attempts          integer NOT NULL DEFAULT 0,
  otp_sent_at           timestamptz,
  signed_at             timestamptz,
  signed_ip             text,
  signed_user_agent     text,

  created_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sent_at               timestamptz,
  expires_at            timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deal_contracts_account ON deal_contracts(account_id);
CREATE INDEX IF NOT EXISTS idx_deal_contracts_deal ON deal_contracts(deal_id);
CREATE UNIQUE INDEX IF NOT EXISTS uidx_deal_contracts_token_hash
  ON deal_contracts(token_hash) WHERE token_hash IS NOT NULL;

ALTER TABLE deal_contracts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deal_contracts_select ON deal_contracts;
CREATE POLICY deal_contracts_select ON deal_contracts FOR SELECT
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS deal_contracts_insert ON deal_contracts;
CREATE POLICY deal_contracts_insert ON deal_contracts FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS deal_contracts_update ON deal_contracts;
CREATE POLICY deal_contracts_update ON deal_contracts FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

CREATE OR REPLACE FUNCTION public.update_deal_contracts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS deal_contracts_updated_at ON deal_contracts;
CREATE TRIGGER deal_contracts_updated_at
  BEFORE UPDATE ON deal_contracts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_deal_contracts_updated_at();

-- ---- deal_contract_events ------------------------------------------------
CREATE TABLE IF NOT EXISTS deal_contract_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id   uuid NOT NULL REFERENCES deal_contracts(id) ON DELETE CASCADE,
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  event_type    text NOT NULL CHECK (event_type IN
                  ('created', 'sent', 'viewed', 'signed', 'declined', 'expired', 'cancelled', 'webhook_received')),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deal_contract_events_contract
  ON deal_contract_events(contract_id);

ALTER TABLE deal_contract_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deal_contract_events_select ON deal_contract_events;
CREATE POLICY deal_contract_events_select ON deal_contract_events FOR SELECT
  USING (is_account_member(account_id));
-- No client write policy — inserted by API routes via the RLS-scoped
-- client (agent-triggered "sent") or the service-role client
-- (system/webhook events), never a direct client mutation.
