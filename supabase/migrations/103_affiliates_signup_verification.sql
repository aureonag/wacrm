-- ============================================================
-- 103_affiliates_signup_verification.sql — código de confirmação de e-mail
-- na inscrição pública de afiliados.
--
-- Escopo
--   Tabela `aff_signup_codes`: um código de 6 dígitos (guardado só como hash
--   SHA-256) por e-mail + campanha, com validade e contador de tentativas —
--   o mesmo desenho do aceite virtual de contratos (otp_code_hash,
--   otp_expires_at, otp_attempts). O afiliado só conclui a inscrição
--   digitando o código que chegou no e-mail dele.
--
-- Acesso
--   RLS ligado e NENHUMA policy: anon/authenticated não leem nem gravam. Só
--   as rotas de API do servidor (service_role) usam esta tabela.
--
-- NÃO mexe em
--   nenhuma tabela, função ou policy existente.
--
-- Idempotente — seguro para rodar várias vezes.
-- ============================================================

CREATE TABLE IF NOT EXISTS aff_signup_codes (
  email       text        NOT NULL,
  campaign_id uuid        NOT NULL REFERENCES aff_campaigns(id) ON DELETE CASCADE,
  code_hash   text        NOT NULL,
  expires_at  timestamptz NOT NULL,
  attempts    integer     NOT NULL DEFAULT 0,
  sent_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (email, campaign_id)
);

ALTER TABLE aff_signup_codes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON aff_signup_codes FROM anon, authenticated;
