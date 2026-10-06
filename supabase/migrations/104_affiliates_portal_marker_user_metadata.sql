-- ============================================================
-- 104_affiliates_portal_marker_user_metadata.sql — corrige a marca de
-- "usuário do portal de afiliados" lida pelo gatilho handle_new_user().
--
-- Problema (visto no primeiro teste real em produção)
--   A migration 101 faz o gatilho ler `raw_app_meta_data->>'aff_portal'`.
--   Mas o Supabase Auth (admin.createUser) insere o usuário primeiro e só
--   DEPOIS grava o app_metadata. No momento do INSERT o gatilho não vê a
--   marca e cria conta + profile do CRM para o afiliado.
--
-- Solução
--   Aceitar a marca também em `raw_user_meta_data->>'aff_portal'`, que o
--   Auth grava já no INSERT. É seguro porque a marca só faz o gatilho PULAR
--   a criação da conta do CRM — quem a forjar fica sem acesso a nada (sem
--   profile não há linha visível por RLS). O ACESSO ao portal continua
--   exigindo `app_metadata.aff_portal = true`, que só o servidor grava.
--
-- Efeito nos fluxos atuais
--   Nenhum: sem a marca, o corpo é idêntico ao de 017/101.
--
-- Idempotente — seguro para rodar várias vezes.
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_full_name TEXT;
  v_account_id UUID;
BEGIN
  -- Usuário do portal de afiliados/clientes: sem conta nem profile do CRM.
  IF COALESCE(NEW.raw_app_meta_data->>'aff_portal', 'false') = 'true'
     OR COALESCE(NEW.raw_user_meta_data->>'aff_portal', 'false') = 'true' THEN
    RETURN NEW;
  END IF;

  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', '');

  INSERT INTO public.accounts (name, owner_user_id)
  VALUES (COALESCE(NULLIF(v_full_name, ''), NEW.email, 'My account'), NEW.id)
  RETURNING id INTO v_account_id;

  INSERT INTO public.profiles (user_id, full_name, email, account_id, account_role)
  VALUES (NEW.id, v_full_name, NEW.email, v_account_id, 'owner');

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to bootstrap account/profile for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;
