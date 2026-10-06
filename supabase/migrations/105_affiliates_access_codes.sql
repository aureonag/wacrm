-- ============================================================
-- 105_affiliates_access_codes.sql — "esqueci minha senha" e convite por e-mail
-- do portal (afiliados e pessoas das lojas).
--
-- Escopo
--   Tabela `aff_access_codes`: UM código ativo por e-mail, guardado só como hash
--   SHA-256, com validade e contador de tentativas — o mesmo desenho de
--   `aff_signup_codes` (103) e do aceite virtual de contratos.
--     purpose = 'reset'  → código de 6 dígitos, vale 10 minutos
--     purpose = 'invite' → token longo enviado no link do convite, vale 3 dias
--
-- Acesso
--   RLS ligado e NENHUMA policy: anon/authenticated não leem nem gravam. Só as
--   rotas de API do servidor (service_role) usam esta tabela.
--
-- NÃO mexe em
--   nenhuma tabela, função ou policy existente.
--
-- Idempotente — seguro para rodar várias vezes.
-- ============================================================

CREATE TABLE IF NOT EXISTS aff_access_codes (
  email      text        PRIMARY KEY,
  purpose    text        NOT NULL CHECK (purpose IN ('reset', 'invite')),
  code_hash  text        NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts   integer     NOT NULL DEFAULT 0,
  sent_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE aff_access_codes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON aff_access_codes FROM anon, authenticated;
