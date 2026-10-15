-- Complete office snapshots contain DMs/private channels and are NOT member-readable.
-- Only the gated Next backend may call these RPCs with its server admin client.
-- No runtime seed or credentials are read/imported by this migration.

CREATE SCHEMA IF NOT EXISTS office_private AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA office_private FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS office_private.runtime_state (
  account_id uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  revision bigint NOT NULL CHECK (revision BETWEEN 1 AND 9007199254740991),
  format_version integer NOT NULL DEFAULT 1 CHECK (format_version = 1),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT office_runtime_aureon_only CHECK (
    account_id = '737433a3-ec29-4e90-b4ba-9989192ca735'::uuid
  )
);

ALTER TABLE office_private.runtime_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE office_private.runtime_state FORCE ROW LEVEL SECURITY;
-- Deliberately no RLS policy and no direct table/schema privileges, even for service_role.
-- SECURITY DEFINER RPCs owned by postgres are the sole backend storage interface.
REVOKE ALL ON TABLE office_private.runtime_state FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.office_runtime_load(p_account_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_revision bigint;
  v_snapshot jsonb;
BEGIN
  IF p_account_id IS DISTINCT FROM '737433a3-ec29-4e90-b4ba-9989192ca735'::uuid THEN
    RAISE EXCEPTION 'Office access is restricted' USING ERRCODE = '42501';
  END IF;

  SELECT s.revision, s.snapshot INTO v_revision, v_snapshot
    FROM office_private.runtime_state s WHERE s.account_id = p_account_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('revision', 0, 'snapshot', NULL);
  END IF;
  RETURN jsonb_build_object('revision', v_revision, 'snapshot', v_snapshot);
END;
$$;

CREATE OR REPLACE FUNCTION public.office_runtime_compare_and_swap(
  p_account_id uuid,
  p_expected_revision bigint,
  p_snapshot jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_committed boolean;
BEGIN
  IF p_account_id IS DISTINCT FROM '737433a3-ec29-4e90-b4ba-9989192ca735'::uuid THEN
    RAISE EXCEPTION 'Office access is restricted' USING ERRCODE = '42501';
  END IF;
  IF p_expected_revision IS NULL OR p_expected_revision < 0
     OR p_expected_revision >= 9007199254740991
     OR p_snapshot IS NULL OR jsonb_typeof(p_snapshot) <> 'object' THEN
    RAISE EXCEPTION 'Invalid office state' USING ERRCODE = '22023';
  END IF;

  IF p_expected_revision = 0 THEN
    -- Two initializers can race; only one may create revision 1.
    INSERT INTO office_private.runtime_state(account_id, revision, snapshot)
      VALUES (p_account_id, 1, p_snapshot)
      ON CONFLICT (account_id) DO NOTHING
      RETURNING true INTO v_committed;
  ELSE
    -- One SQL statement locks/rechecks the expected revision across processes.
    -- A stale writer updates zero rows and must reload rather than overwrite.
    UPDATE office_private.runtime_state
       SET snapshot = p_snapshot, revision = revision + 1, updated_at = now()
     WHERE account_id = p_account_id AND revision = p_expected_revision
     RETURNING true INTO v_committed;
  END IF;

  RETURN COALESCE(v_committed, false);
END;
$$;

ALTER FUNCTION public.office_runtime_load(uuid) OWNER TO postgres;
ALTER FUNCTION public.office_runtime_compare_and_swap(uuid, bigint, jsonb) OWNER TO postgres;
-- Supabase may assign direct default grants; revoking PUBLIC alone is insufficient (153).
REVOKE ALL ON FUNCTION public.office_runtime_load(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.office_runtime_compare_and_swap(uuid, bigint, jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.office_runtime_load(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.office_runtime_compare_and_swap(uuid, bigint, jsonb) TO service_role;
