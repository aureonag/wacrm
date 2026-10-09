-- ============================================================
-- 155_security_affiliates_platform_staff.sql — "time do Afiliados" passa a ser
-- só a equipe da conta Aureon (achado F02 do suplemento, 2026-10-08).
--
-- Problema
--   aff_is_staff() (100) = "owner ou admin de QUALQUER conta". O cadastro
--   público do CRM cria uma conta nova com o usuário como owner, então
--   qualquer pessoa que se cadastra passa nas policies ALL de aff_clients /
--   aff_affiliates / aff_commissions (e nas rotas de servidor, que usavam a
--   mesma regra via requireRole("admin")).
--
-- Decisão assumida (confirme): a administração do programa de afiliados é
--   CENTRAL — só a equipe (owner/admin) da conta Aureon. Se algum dia cada
--   conta tiver o próprio programa, as tabelas aff_* precisam de account_id.
--
-- O que faz
--   * Tabela de uma linha `aff_platform_account` com o id da conta Aureon,
--     preenchida a partir do owner allan.giro@aureonag.com.br. Se essa conta
--     não for encontrada, a migration ABORTA (não deixa ninguém trancado).
--   * aff_is_staff() passa a exigir owner/admin DESSA conta. Só o corpo da
--     função muda; nenhuma policy muda (como previsto na 100).
--   * O código (src/lib/affiliates/admin.ts) lê a mesma tabela.
--
-- Não toca no sistema de Cargos/Permissões do CRM.
-- Idempotente — seguro para rodar várias vezes.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.aff_platform_account (
  singleton  boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE RESTRICT
);

ALTER TABLE public.aff_platform_account ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.aff_platform_account FROM anon, authenticated;
-- Sem policies: só service_role (rotas do servidor) e funções SECURITY DEFINER leem.

DO $$
DECLARE
  v_account uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.aff_platform_account) THEN
    RETURN;
  END IF;
  -- Banco vazio (CI que reaplica todas as migrations do zero): nada a semear.
  IF NOT EXISTS (SELECT 1 FROM public.profiles) THEN
    RETURN;
  END IF;

  SELECT p.account_id INTO v_account
    FROM public.profiles p
    JOIN auth.users u ON u.id = p.user_id
   WHERE lower(u.email) = 'allan.giro@aureonag.com.br'
     AND p.account_role = 'owner'
   LIMIT 1;

  IF v_account IS NULL THEN
    RAISE EXCEPTION
      'Conta Aureon não encontrada (owner allan.giro@aureonag.com.br). Ajuste o e-mail neste arquivo antes de rodar.';
  END IF;

  INSERT INTO public.aff_platform_account (singleton, account_id) VALUES (true, v_account);
END $$;

CREATE OR REPLACE FUNCTION public.aff_is_staff()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.profiles p
      JOIN public.aff_platform_account pa ON pa.account_id = p.account_id
     WHERE p.user_id = auth.uid()
       AND p.account_role IN ('owner', 'admin')
  );
$$;

REVOKE ALL ON FUNCTION public.aff_is_staff() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aff_is_staff() TO authenticated, service_role;

-- Validação manual:
--   SELECT * FROM aff_platform_account;            -- 1 linha, a conta da Aureon
--   Allan abre Operacional -> Afiliados            -- continua funcionando
--   Um cadastro novo de teste (outra conta owner)  -- recebe 403 nas rotas /api/operational/affiliates/*
