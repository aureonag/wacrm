-- ============================================================
-- 101_affiliates_auth_bootstrap.sql — usuários do módulo Afiliados
-- (clientes e afiliados) NÃO recebem conta/profile do CRM.
--
-- Problema
--   handle_new_user() (017) cria uma `account` + `profile` (owner) para
--   TODO usuário novo do Supabase Auth. Um cliente ou afiliado criado
--   pelo Auth viraria dono de uma conta do CRM.
--
-- Solução
--   Usuários criados pelo módulo Afiliados (somente via service_role,
--   admin.createUser / inviteUserByEmail) levam em `raw_app_meta_data`
--   a marca {"aff_portal": true}. `raw_app_meta_data` só é gravável pelo
--   servidor (nunca pelo signUp público), então um visitante não consegue
--   forjar nem remover a marca. Com a marca, o trigger não cria nada.
--
-- Efeito nos fluxos atuais
--   Nenhum: sem a marca, o corpo é idêntico ao de 017.
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
  IF COALESCE(NEW.raw_app_meta_data->>'aff_portal', 'false') = 'true' THEN
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

-- Marcador de prontidão: o app só cria usuários do portal (inscrição pública
-- de afiliados) depois de confirmar que ESTA migration foi aplicada. Sem ela,
-- cada afiliado novo viraria dono de uma conta do CRM (handle_new_user de 017).
-- Somente o servidor (service_role) pode chamá-la.
CREATE OR REPLACE FUNCTION public.aff_portal_ready()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT true; $$;

REVOKE ALL ON FUNCTION public.aff_portal_ready() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aff_portal_ready() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aff_portal_ready() TO service_role;
