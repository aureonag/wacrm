-- ============================================================
-- 150_security_profiles_role_id_guard.sql — fecha a escalada de privilégio
-- via profiles.role_id (achado C1 da revisão de segurança, 2026-10-01).
--
-- Problema
--   A policy `profiles_update` deixa o usuário editar a PRÓPRIA linha, e o
--   trigger da migration 034 só protege `account_role` e `account_id`.
--   `role_id` (o cargo, migration 058) é a base do `has_permission()`, então
--   um membro conseguia fazer, pela REST do Supabase:
--     PATCH /rest/v1/profiles?user_id=eq.<self>  { "role_id": "<cargo Admin>" }
--   e ganhar todas as permissões desse cargo.
--
-- Correção
--   Mesmo guard da 034, agora também para `role_id`. Só bloqueia quando o
--   chamador é o papel `authenticated` (o navegador). Continuam funcionando:
--     - set_member_custom_role / admin_assign_new_member / handle_new_user
--       (SECURITY DEFINER, dono postgres → current_user = 'postgres');
--     - rotas do servidor com service_role;
--     - o formulário de perfil (só altera full_name e avatar_url);
--     - o ON DELETE SET NULL de roles (ação referencial roda como dono).
--
-- Idempotente — seguro para rodar várias vezes.
-- ============================================================

CREATE OR REPLACE FUNCTION public.enforce_profile_privilege_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (NEW.account_role IS DISTINCT FROM OLD.account_role
      OR NEW.account_id IS DISTINCT FROM OLD.account_id
      OR NEW.role_id IS DISTINCT FROM OLD.role_id)
     AND current_user = 'authenticated'
  THEN
    RAISE EXCEPTION
      'account_role, account_id and role_id cannot be changed directly; use the account member RPCs'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.enforce_profile_privilege_columns() OWNER TO postgres;

-- O trigger da 034 já aponta para esta função; recriar só garante que existe.
DROP TRIGGER IF EXISTS enforce_profile_privilege_columns ON public.profiles;
CREATE TRIGGER enforce_profile_privilege_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_profile_privilege_columns();

-- ============================================================
-- Validação manual (staging, com JWT de um membro comum):
--   PATCH /rest/v1/profiles?user_id=eq.<self> {"role_id":"<outro cargo>"}  → 42501
--   PATCH /rest/v1/profiles?user_id=eq.<self> {"full_name":"Novo Nome"}    → 204
--   Settings → Membros → trocar o cargo de alguém (RPC)                    → funciona
-- ============================================================
