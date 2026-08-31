-- ============================================================
-- 045_admin_create_member.sql — admin-provisioned member RPC
--
-- Companion to 019_invitation_rpcs.sql's redeem_invitation, but
-- driven by the ADMIN instead of the invitee: the "Criar acesso
-- agora" mode in the Members tab creates the auth user directly
-- (via the Admin API, service-role, in the API route) with a
-- password the admin sets, then calls this RPC to move that
-- brand-new user out of their auto-created personal account and
-- into the admin's account with the chosen role — skipping the
-- invite-link / self-signup round trip entirely.
--
-- SECURITY DEFINER because moving another user's profile.account_id
-- crosses the same RLS boundary redeem_invitation crosses; unlike
-- redeem_invitation (caller = the person joining), here the caller
-- is the admin acting on someone else's profile, so both sides of
-- the identity get checked explicitly below.
-- ============================================================

CREATE OR REPLACE FUNCTION public.admin_assign_new_member(
  p_user_id UUID,
  p_role account_role_enum
) RETURNS UUID  -- the account_id the user was assigned into
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_caller_account_id UUID;
  v_caller_role account_role_enum;
  v_target_account_id UUID;
  v_target_account_owner UUID;
  v_has_data BOOLEAN;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_role = 'owner' THEN
    RAISE EXCEPTION 'Cannot assign the owner role' USING ERRCODE = '22023';
  END IF;

  -- Caller must be admin+ in their own account. The API route
  -- already checks this via requireRole('admin'), but a
  -- SECURITY DEFINER function re-checks independently rather than
  -- trusting the caller — same idiom as every other RPC in this
  -- series.
  SELECT account_id, account_role INTO v_caller_account_id, v_caller_role
  FROM profiles
  WHERE user_id = v_caller_id;

  IF v_caller_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no profile' USING ERRCODE = '42501';
  END IF;
  IF v_caller_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Insufficient role' USING ERRCODE = '42501';
  END IF;

  -- Target must exist and currently be the sole owner of an empty
  -- personal account — i.e. a user that was JUST created by
  -- auth.admin.createUser() moments ago, via the on_auth_user_created
  -- trigger. Same safety checks as redeem_invitation: refuse rather
  -- than silently evicting someone from a real, populated account.
  SELECT p.account_id, a.owner_user_id
  INTO v_target_account_id, v_target_account_owner
  FROM profiles p
  JOIN accounts a ON a.id = p.account_id
  WHERE p.user_id = p_user_id;

  IF v_target_account_id IS NULL THEN
    RAISE EXCEPTION 'Target user has no profile' USING ERRCODE = '22023';
  END IF;

  IF v_target_account_id = v_caller_account_id THEN
    RAISE EXCEPTION 'User is already a member of this account'
      USING ERRCODE = '23505';
  END IF;

  IF v_target_account_owner <> p_user_id THEN
    RAISE EXCEPTION 'Target account is not eligible for reassignment'
      USING ERRCODE = '23505';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM contacts WHERE account_id = v_target_account_id
    UNION ALL SELECT 1 FROM conversations WHERE account_id = v_target_account_id
    UNION ALL SELECT 1 FROM broadcasts WHERE account_id = v_target_account_id
    UNION ALL SELECT 1 FROM automations WHERE account_id = v_target_account_id
    UNION ALL SELECT 1 FROM flows WHERE account_id = v_target_account_id
    UNION ALL SELECT 1 FROM pipelines WHERE account_id = v_target_account_id
    UNION ALL SELECT 1 FROM message_templates WHERE account_id = v_target_account_id
    UNION ALL SELECT 1 FROM tags WHERE account_id = v_target_account_id
    UNION ALL SELECT 1 FROM custom_fields WHERE account_id = v_target_account_id
    UNION ALL SELECT 1 FROM contact_notes WHERE account_id = v_target_account_id
    UNION ALL SELECT 1 FROM whatsapp_config WHERE account_id = v_target_account_id
    LIMIT 1
  ) INTO v_has_data;

  IF v_has_data THEN
    RAISE EXCEPTION 'Target account is not eligible for reassignment'
      USING ERRCODE = '23505';
  END IF;

  UPDATE profiles
  SET account_id = v_caller_account_id,
      account_role = p_role
  WHERE user_id = p_user_id;

  DELETE FROM accounts WHERE id = v_target_account_id;

  RETURN v_caller_account_id;
END;
$$;

ALTER FUNCTION public.admin_assign_new_member(UUID, account_role_enum) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_assign_new_member(UUID, account_role_enum) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_assign_new_member(UUID, account_role_enum) TO authenticated;
