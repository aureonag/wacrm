-- ============================================================
-- 059_role_sector_admin_rpcs.sql — admin RPCs for assigning a
-- custom cargo / setores to a teammate.
--
-- Why RPCs and not direct UPDATEs from the client
--   Same reason as migration 018's set_member_role: `profiles`'
--   RLS only allows a user to update their own row, so an admin
--   assigning a teammate's cargo needs a SECURITY DEFINER escape
--   hatch that re-checks authority itself. Mirrors 018's error
--   contract exactly (42501 forbidden, 22023 bad input).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_member_custom_role(
  p_user_id UUID,
  p_role_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_account_id UUID;
  v_caller_role account_role_enum;
  v_target_account_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT account_id, account_role INTO v_caller_account_id, v_caller_role
  FROM profiles WHERE user_id = auth.uid();

  IF v_caller_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'This action requires the admin role or higher' USING ERRCODE = '42501';
  END IF;

  SELECT account_id INTO v_target_account_id FROM profiles WHERE user_id = p_user_id;

  IF v_target_account_id IS NULL THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;
  IF v_target_account_id <> v_caller_account_id THEN
    RAISE EXCEPTION 'Target user is not a member of your account' USING ERRCODE = '42501';
  END IF;

  IF p_role_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM roles WHERE id = p_role_id AND account_id = v_caller_account_id
  ) THEN
    RAISE EXCEPTION 'Role does not belong to your account' USING ERRCODE = '22023';
  END IF;

  UPDATE profiles SET role_id = p_role_id WHERE user_id = p_user_id;
END;
$$;

ALTER FUNCTION public.set_member_custom_role(UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_member_custom_role(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_member_custom_role(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_member_sectors(
  p_user_id UUID,
  p_sector_ids UUID[]
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_account_id UUID;
  v_caller_role account_role_enum;
  v_target_profile_id UUID;
  v_target_account_id UUID;
  v_matching_sectors INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT account_id, account_role INTO v_caller_account_id, v_caller_role
  FROM profiles WHERE user_id = auth.uid();

  IF v_caller_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no account' USING ERRCODE = '42501';
  END IF;

  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'This action requires the admin role or higher' USING ERRCODE = '42501';
  END IF;

  SELECT id, account_id INTO v_target_profile_id, v_target_account_id
  FROM profiles WHERE user_id = p_user_id;

  IF v_target_profile_id IS NULL THEN
    RAISE EXCEPTION 'Target user not found' USING ERRCODE = '22023';
  END IF;
  IF v_target_account_id <> v_caller_account_id THEN
    RAISE EXCEPTION 'Target user is not a member of your account' USING ERRCODE = '42501';
  END IF;

  IF array_length(p_sector_ids, 1) IS NOT NULL THEN
    SELECT count(*) INTO v_matching_sectors
    FROM sectors WHERE id = ANY(p_sector_ids) AND account_id = v_caller_account_id;
    IF v_matching_sectors <> array_length(p_sector_ids, 1) THEN
      RAISE EXCEPTION 'One or more sectors do not belong to your account' USING ERRCODE = '22023';
    END IF;
  END IF;

  DELETE FROM user_sectors WHERE profile_id = v_target_profile_id;
  IF array_length(p_sector_ids, 1) IS NOT NULL THEN
    INSERT INTO user_sectors (profile_id, sector_id)
    SELECT v_target_profile_id, s FROM unnest(p_sector_ids) AS s;
  END IF;
END;
$$;

ALTER FUNCTION public.set_member_sectors(UUID, UUID[]) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_member_sectors(UUID, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_member_sectors(UUID, UUID[]) TO authenticated;
