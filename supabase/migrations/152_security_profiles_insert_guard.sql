-- ============================================================
-- 152_security_profiles_insert_guard.sql — fecha o INSERT em profiles
-- (achado F01 do suplemento de segurança, 2026-10-08).
--
-- Problema
--   `profiles_insert` (017) só exige `auth.uid() = user_id`, e o trigger da
--   034/109 só cobre UPDATE. Um usuário autenticado SEM perfil (ex.: cadastro
--   com user_metadata.aff_portal=true, que faz handle_new_user pular o perfil)
--   conseguia inserir o próprio perfil escolhendo `account_id` (de qualquer
--   conta existente) e `account_role = 'owner'`, virando membro/dono de outra
--   conta. Os ids de conta aparecem em URLs públicas de mídia (chat-media).
--
-- Correção
--   * Nenhum código do app insere em profiles pelo navegador: o perfil nasce
--     em handle_new_user / RPCs SECURITY DEFINER (dono postgres) ou rotas do
--     servidor com service_role. Então: remove a policy de INSERT e o GRANT de
--     INSERT de anon/authenticated.
--   * Defesa em profundidade: o trigger de privilégio passa a rodar também em
--     INSERT e bloqueia o papel `authenticated` caso um grant volte.
--
-- Não muda: cadastro normal, convites, "Criar acesso agora", portal de
-- afiliados (todos usam definer/service_role). Edição de nome/avatar (UPDATE).
--
-- Idempotente — seguro para rodar várias vezes.
-- ============================================================

DROP POLICY IF EXISTS profiles_insert ON public.profiles;
REVOKE INSERT ON public.profiles FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.enforce_profile_privilege_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user = 'authenticated' THEN
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'profiles cannot be created directly; they are provisioned by the server'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NEW.account_role IS DISTINCT FROM OLD.account_role
       OR NEW.account_id IS DISTINCT FROM OLD.account_id
       OR NEW.role_id IS DISTINCT FROM OLD.role_id THEN
      RAISE EXCEPTION
        'account_role, account_id and role_id cannot be changed directly; use the account member RPCs'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.enforce_profile_privilege_columns() OWNER TO postgres;

DROP TRIGGER IF EXISTS enforce_profile_privilege_columns ON public.profiles;
CREATE TRIGGER enforce_profile_privilege_columns
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_profile_privilege_columns();

-- Validação manual (staging):
--   POST /rest/v1/profiles {user_id:<self>, account_id:<outra>, account_role:'owner'} -> 401/403/42501
--   Cadastro novo, convite aceito, "Criar acesso agora", edição de nome/avatar       -> seguem funcionando
