-- ============================================================
-- 079_nav_permissions.sql — extends migration 058's permission
-- catalog to cover the main Comercial sidebar (sidebar.tsx), and
-- adds the admin RPC for per-person overrides that 058 built the
-- schema for but never shipped a UI for (user_permission_overrides).
--
-- Why a backfill is required
--   Inserting a permission row grants it to nobody by default. Every
--   account already has members actively using Inbox, Notifications,
--   etc. with zero gating today — without granting these new
--   `comercial:*:view` permissions to every existing role right away,
--   this migration would silently hide those sections from everyone
--   except the account owner the moment the app deploys. The backfill
--   preserves current behaviour (everyone sees everything); an admin
--   opts into restricting access afterwards via Cargos e permissões.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ---- new nav permissions (comercial:<module>:view) ------------------------
-- dashboard/pipelines/contacts already exist since migration 058.
INSERT INTO permissions (environment, module, action, label) VALUES
  ('comercial', 'inbox', 'view', 'Visualizar'),
  ('comercial', 'notifications', 'view', 'Visualizar'),
  ('comercial', 'prospecting', 'view', 'Visualizar'),
  ('comercial', 'activities', 'view', 'Visualizar'),
  ('comercial', 'broadcasts', 'view', 'Visualizar'),
  ('comercial', 'automations', 'view', 'Visualizar'),
  ('comercial', 'flows', 'view', 'Visualizar'),
  ('comercial', 'agents', 'view', 'Visualizar'),
  ('comercial', 'playbook', 'view', 'Visualizar')
ON CONFLICT (environment, module, action) DO NOTHING;

-- ---- backfill: grant every new nav permission to every existing role ------
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM roles r
  CROSS JOIN permissions p
 WHERE p.environment = 'comercial'
   AND p.module IN ('inbox', 'notifications', 'prospecting', 'activities',
                     'broadcasts', 'automations', 'flows', 'agents', 'playbook')
   AND p.action = 'view'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ---- set_member_permission_overrides ---------------------------------------
-- Same auth skeleton as set_member_sectors (059): caller must be
-- admin+, target must be in the caller's account. Full-replace
-- semantics — a permission_id absent from p_overrides has no override
-- (falls back to the member's cargo), matching set_member_sectors'
-- delete-then-insert pattern.
CREATE OR REPLACE FUNCTION public.set_member_permission_overrides(
  p_user_id UUID,
  p_overrides JSONB -- array of {"permission_id": uuid, "granted": bool}
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
  v_override_count INT;
  v_matching_permissions INT;
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

  IF jsonb_typeof(p_overrides) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'p_overrides must be a JSON array' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_override_count FROM jsonb_array_elements(p_overrides);
  IF v_override_count > 0 THEN
    SELECT count(*) INTO v_matching_permissions
      FROM permissions
     WHERE id IN (SELECT (elem->>'permission_id')::uuid FROM jsonb_array_elements(p_overrides) AS elem);
    IF v_matching_permissions <> v_override_count THEN
      RAISE EXCEPTION 'One or more permissions do not exist' USING ERRCODE = '22023';
    END IF;
  END IF;

  DELETE FROM user_permission_overrides WHERE profile_id = v_target_profile_id;
  IF v_override_count > 0 THEN
    INSERT INTO user_permission_overrides (profile_id, permission_id, granted)
    SELECT v_target_profile_id, (elem->>'permission_id')::uuid, (elem->>'granted')::boolean
    FROM jsonb_array_elements(p_overrides) AS elem;
  END IF;
END;
$$;

ALTER FUNCTION public.set_member_permission_overrides(UUID, JSONB) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_member_permission_overrides(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_member_permission_overrides(UUID, JSONB) TO authenticated;
