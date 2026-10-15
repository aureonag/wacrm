-- Read-only catalog assertions for migration 156, after migrations in disposable CI.
-- Run: supabase db query --local --file supabase/ci/verify-office-runtime.sql
-- Exactly ONE top-level statement, as required by Supabase db query --file.
-- This does not call an office RPC, read a snapshot, write data, or change roles.
-- CAS checks inspect its definition; execution/locking races need a separate DB test.
DO $office_ci$
DECLARE
  v_schema oid := to_regnamespace('office_private');
  v_table oid := to_regclass('office_private.runtime_state');
  v_load oid := to_regprocedure('public.office_runtime_load(uuid)');
  v_cas oid := to_regprocedure('public.office_runtime_compare_and_swap(uuid,bigint,jsonb)');
  v_owner oid;
  v_role text;
  v_privilege text;
  v_rpc record;
  v_source text;
  v_account_column smallint;
BEGIN
  IF v_schema IS NULL OR v_table IS NULL OR v_load IS NULL OR v_cas IS NULL THEN
    RAISE EXCEPTION 'Office schema, table or exact RPC signatures are missing (156)';
  END IF;

  SELECT relowner INTO v_owner FROM pg_catalog.pg_class WHERE oid = v_table;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_roles r ON r.oid = c.relowner
    WHERE c.oid = v_table AND c.relkind = 'r' AND c.relrowsecurity AND c.relforcerowsecurity
      AND r.rolname = 'postgres' AND (r.rolsuper OR r.rolbypassrls)
  ) THEN
    RAISE EXCEPTION 'Office table must force RLS and have the privileged postgres owner';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = v_table) THEN
    RAISE EXCEPTION 'Raw office snapshots must have no member-readable RLS policy';
  END IF;
  IF (SELECT nspowner FROM pg_catalog.pg_namespace WHERE oid = v_schema) IS DISTINCT FROM v_owner THEN
    RAISE EXCEPTION 'Office private schema must have the same privileged owner';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_proc p WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('office_runtime_load', 'office_runtime_compare_and_swap')) <> 2 THEN
    RAISE EXCEPTION 'Unexpected office RPC overloads require a security review';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_namespace n,
      LATERAL pg_catalog.aclexplode(COALESCE(n.nspacl, pg_catalog.acldefault('n', n.nspowner))) a
    WHERE n.oid = v_schema AND (n.nspowner <> v_owner OR a.grantee <> n.nspowner)
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c,
      LATERAL pg_catalog.aclexplode(COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
    WHERE c.oid = v_table AND a.grantee <> c.relowner
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute c,
      LATERAL pg_catalog.aclexplode(CASE WHEN cardinality(c.attacl) > 0 THEN c.attacl ELSE NULL::aclitem[] END) a
    WHERE c.attrelid = v_table AND NOT c.attisdropped AND a.grantee <> v_owner
  ) THEN
    RAISE EXCEPTION 'Office private schema/table/columns have unexpected direct grants';
  END IF;

  -- Effective checks also catch inherited privileges, rather than only direct ACLs.
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    FOREACH v_privilege IN ARRAY ARRAY['USAGE', 'CREATE'] LOOP
      IF pg_catalog.has_schema_privilege(v_role, v_schema, v_privilege) THEN
        RAISE EXCEPTION 'Role % can directly access private office schema (%)', v_role, v_privilege;
      END IF;
    END LOOP;
    FOREACH v_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      IF pg_catalog.has_table_privilege(v_role, v_table, v_privilege) THEN
        RAISE EXCEPTION 'Role % has direct office table privilege %', v_role, v_privilege;
      END IF;
    END LOOP;
    FOREACH v_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'] LOOP
      IF pg_catalog.has_any_column_privilege(v_role, v_table, v_privilege) THEN
        RAISE EXCEPTION 'Role % has direct office column privilege %', v_role, v_privilege;
      END IF;
    END LOOP;
  END LOOP;

  SELECT attnum INTO v_account_column FROM pg_catalog.pg_attribute
    WHERE attrelid = v_table AND attname = 'account_id' AND NOT attisdropped;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = v_table
      AND contype = 'p' AND conkey = ARRAY[v_account_column]::smallint[]) THEN
    RAISE EXCEPTION 'Office CAS initial insert requires the account_id primary key';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = v_table AND conname = 'office_runtime_aureon_only' AND contype = 'c' AND convalidated
      AND replace(regexp_replace(pg_catalog.pg_get_expr(conbin, conrelid), '[[:space:]()]', '', 'g'), '::uuid', '')
        = 'account_id=''737433a3-ec29-4e90-b4ba-9989192ca735'''
  ) THEN
    RAISE EXCEPTION 'Office table must accept only the confirmed Aureon account';
  END IF;

  FOR v_rpc IN SELECT p.*, r.rolname AS owner_name, l.lanname AS language_name
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_roles r ON r.oid = p.proowner
    JOIN pg_catalog.pg_language l ON l.oid = p.prolang WHERE p.oid IN (v_load, v_cas)
  LOOP
    IF NOT v_rpc.prosecdef OR v_rpc.owner_name <> 'postgres' OR v_rpc.proowner <> v_owner
      OR v_rpc.language_name <> 'plpgsql' OR v_rpc.proretset
      OR NOT COALESCE('search_path=pg_catalog' = ANY(v_rpc.proconfig), false)
      OR (v_rpc.oid = v_cas AND v_rpc.provolatile <> 'v')
      OR v_rpc.prorettype <> (CASE WHEN v_rpc.oid = v_load THEN 'jsonb'::regtype ELSE 'boolean'::regtype END) THEN
      RAISE EXCEPTION 'Office RPC % has unsafe owner/security/search_path/signature settings', v_rpc.proname;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_rpc.proacl, pg_catalog.acldefault('f', v_rpc.proowner))) a
      WHERE a.grantee <> v_rpc.proowner AND
        (a.grantee <> (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'service_role')
          OR a.privilege_type <> 'EXECUTE' OR a.is_grantable)
    ) OR NOT pg_catalog.has_function_privilege('service_role', v_rpc.oid, 'EXECUTE')
      OR pg_catalog.has_function_privilege('anon', v_rpc.oid, 'EXECUTE')
      OR pg_catalog.has_function_privilege('authenticated', v_rpc.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Office RPC % must be executable only by backend service_role and owner', v_rpc.proname;
    END IF;
    -- Structural regression guards, deliberately narrower than a general SQL proof.
    v_source := regexp_replace(lower(regexp_replace(v_rpc.prosrc, '--[^\n]*', ' ', 'g')), '[[:space:]]+', ' ', 'g');
    IF position('p_account_id is distinct from ''737433a3-ec29-4e90-b4ba-9989192ca735''::uuid' IN v_source) = 0 THEN
      RAISE EXCEPTION 'Office RPC % is missing the NULL-safe account gate', v_rpc.proname;
    END IF;
    IF v_rpc.oid = v_cas THEN
      IF position('p_expected_revision is null or p_expected_revision < 0' IN v_source) = 0
        OR position('p_expected_revision >= 9007199254740991' IN v_source) = 0
        OR position('p_snapshot is null or jsonb_typeof(p_snapshot) <> ''object''' IN v_source) = 0
        OR v_source !~ 'if p_expected_revision = 0 then .*insert into office_private[.]runtime_state.*on conflict [(]account_id[)] do nothing'
        OR v_source !~ 'update office_private[.]runtime_state set snapshot = p_snapshot, revision = revision [+] 1, updated_at = now[(][)] where account_id = p_account_id and revision = p_expected_revision returning true into v_committed'
        OR position('return coalesce(v_committed, false)' IN v_source) = 0 THEN
        RAISE EXCEPTION 'Office CAS lost payload/revision validation or atomic conflict guards';
      END IF;
    END IF;
  END LOOP;
  RAISE NOTICE 'Office read-only catalog verification passed; runtime/CAS concurrency was not executed';
END;
$office_ci$;
