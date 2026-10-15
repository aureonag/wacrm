-- Read-only catalog verifier for migration157 in disposable CI: exactly ONE statement.
-- No nonce RPC execution, app data reads, writes, role changes or secret access.
-- Structural guards do not replace a live multi-session concurrency test.
DO $office_nonce_ci$
DECLARE
  v_schema oid := to_regnamespace('office_private');
  v_table oid := to_regclass('office_private.gateway_nonces');
  v_function oid := to_regprocedure('public.office_gateway_claim_nonce(uuid,text,bigint)');
  v_owner oid;
  v_role text;
  v_privilege text;
  v_rpc record;
  v_source text;
  v_account smallint;
  v_nonce smallint;
BEGIN
  IF v_schema IS NULL OR v_table IS NULL OR v_function IS NULL THEN
    RAISE EXCEPTION 'Office gateway schema, table or exact RPC is missing (157)';
  END IF;
  SELECT relowner INTO v_owner FROM pg_catalog.pg_class WHERE oid = v_table;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_roles r ON r.oid = c.relowner
    WHERE c.oid = v_table AND c.relkind = 'r' AND c.relrowsecurity AND c.relforcerowsecurity
      AND r.rolname = 'postgres' AND (r.rolsuper OR r.rolbypassrls))
    OR (SELECT nspowner FROM pg_catalog.pg_namespace WHERE oid = v_schema) IS DISTINCT FROM v_owner THEN
    RAISE EXCEPTION 'Office gateway must force RLS and have the privileged postgres owner';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = v_table) THEN
    RAISE EXCEPTION 'Office gateway nonce table must have no RLS policy';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_namespace n,
    LATERAL pg_catalog.aclexplode(COALESCE(n.nspacl, pg_catalog.acldefault('n', n.nspowner))) a
    WHERE n.oid = v_schema AND a.grantee <> n.nspowner)
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c,
    LATERAL pg_catalog.aclexplode(COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))) a
    WHERE c.oid = v_table AND a.grantee <> c.relowner)
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_attribute c,
    LATERAL pg_catalog.aclexplode(CASE WHEN cardinality(c.attacl) > 0 THEN c.attacl ELSE NULL::aclitem[] END) a
    WHERE c.attrelid = v_table AND NOT c.attisdropped AND a.grantee <> v_owner) THEN
    RAISE EXCEPTION 'Office gateway private schema/table/columns have unexpected direct grants';
  END IF;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    FOREACH v_privilege IN ARRAY ARRAY['USAGE', 'CREATE'] LOOP
      IF pg_catalog.has_schema_privilege(v_role, v_schema, v_privilege) THEN
        RAISE EXCEPTION 'Role % has direct office gateway schema privilege %', v_role, v_privilege;
      END IF;
    END LOOP;
    FOREACH v_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      IF pg_catalog.has_table_privilege(v_role, v_table, v_privilege) THEN
        RAISE EXCEPTION 'Role % has direct office gateway table privilege %', v_role, v_privilege;
      END IF;
    END LOOP;
    FOREACH v_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'] LOOP
      IF pg_catalog.has_any_column_privilege(v_role, v_table, v_privilege) THEN
        RAISE EXCEPTION 'Role % has direct office gateway column privilege %', v_role, v_privilege;
      END IF;
    END LOOP;
  END LOOP;
  SELECT attnum INTO v_account FROM pg_catalog.pg_attribute
    WHERE attrelid = v_table AND attname = 'account_id' AND atttypid = 'uuid'::regtype AND attnotnull AND NOT attisdropped;
  SELECT attnum INTO v_nonce FROM pg_catalog.pg_attribute
    WHERE attrelid = v_table AND attname = 'nonce' AND atttypid = 'text'::regtype AND attnotnull AND NOT attisdropped;
  IF v_account IS NULL OR v_nonce IS NULL OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
      WHERE attrelid = v_table AND attname = 'expires_at' AND atttypid = 'timestamptz'::regtype AND attnotnull AND NOT attisdropped)
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = v_table AND contype = 'p'
      AND conkey = ARRAY[v_account, v_nonce]::smallint[]) THEN
    RAISE EXCEPTION 'Office gateway nonce fields or composite primary key are missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = v_table
    AND conname = 'office_gateway_nonces_aureon_only' AND contype = 'c' AND convalidated
    AND replace(regexp_replace(pg_catalog.pg_get_expr(conbin, conrelid), '[[:space:]()]', '', 'g'), '::uuid', '')
      = 'account_id=''737433a3-ec29-4e90-b4ba-9989192ca735''')
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = v_table
      AND conname = 'office_gateway_nonces_nonce_format' AND contype = 'c' AND convalidated
      AND position('^[0-9a-f]{32}$' IN pg_catalog.pg_get_expr(conbin, conrelid)) > 0)
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = v_table AND contype = 'f'
      AND confrelid = 'public.accounts'::regclass AND conkey = ARRAY[v_account]::smallint[] AND confdeltype = 'c') THEN
    RAISE EXCEPTION 'Office gateway account/nonce constraints or cascading account FK are missing';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_proc WHERE pronamespace = 'public'::regnamespace
    AND proname = 'office_gateway_claim_nonce') <> 1 THEN
    RAISE EXCEPTION 'Unexpected office gateway nonce RPC overloads';
  END IF;
  SELECT p.*, r.rolname AS owner_name, l.lanname AS language_name INTO v_rpc
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_roles r ON r.oid = p.proowner
    JOIN pg_catalog.pg_language l ON l.oid = p.prolang WHERE p.oid = v_function;
  IF NOT v_rpc.prosecdef OR v_rpc.owner_name <> 'postgres' OR v_rpc.proowner <> v_owner
    OR v_rpc.language_name <> 'plpgsql' OR v_rpc.proretset OR v_rpc.provolatile <> 'v'
    OR v_rpc.prorettype <> 'boolean'::regtype
    OR NOT COALESCE('search_path=pg_catalog' = ANY(v_rpc.proconfig), false) THEN
    RAISE EXCEPTION 'Office gateway RPC has unsafe owner/security/search_path/signature settings';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(v_rpc.proacl, pg_catalog.acldefault('f', v_owner))) a
    WHERE a.grantee <> v_owner AND (a.grantee <> (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'service_role')
      OR a.privilege_type <> 'EXECUTE' OR a.is_grantable))
    OR NOT pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE')
    OR pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE') THEN
    RAISE EXCEPTION 'Office gateway RPC must be executable only by backend service_role and owner';
  END IF;
  v_source := regexp_replace(lower(regexp_replace(v_rpc.prosrc, '--[^\n]*', ' ', 'g')), '[[:space:]]+', ' ', 'g');
  IF position('p_account_id is distinct from ''737433a3-ec29-4e90-b4ba-9989192ca735''::uuid' IN v_source) = 0
    OR position('p_nonce is null or p_nonce !~ ''^[0-9a-f]{32}$''' IN v_source) = 0
    OR position('p_issued_at_ms is null or p_issued_at_ms < 0' IN v_source) = 0
    OR position('p_issued_at_ms > 9007199254740991' IN v_source) = 0
    OR position('current_setting(''transaction_isolation'') <> ''read committed''' IN v_source) = 0
    OR v_source !~ 'perform pg_advisory_xact_lock[(]1096107863, 157[)]; v_now := clock_timestamp[(][)];'
    OR position('abs(v_now_ms - p_issued_at_ms) >= 60000' IN v_source) = 0
    OR position('delete from office_private.gateway_nonces where account_id = p_account_id and expires_at <= v_now' IN v_source) = 0
    OR v_source !~ 'if exists [(]select 1 from office_private[.]gateway_nonces where account_id = p_account_id and nonce = p_nonce[)] then return false;'
    OR v_source !~ 'if [(]select count[(][*][)] from office_private[.]gateway_nonces where account_id = p_account_id[)] >= 10000'
    OR position('values (p_account_id, p_nonce, v_now + interval ''120 seconds'')' IN v_source) = 0
    OR position('on conflict (account_id, nonce) do nothing returning true into v_claimed' IN v_source) = 0
    OR position('return coalesce(v_claimed, false)' IN v_source) = 0 THEN
    RAISE EXCEPTION 'Office gateway RPC lost account/clock/cap/lock/TTL/replay structural guards';
  END IF;
  RAISE NOTICE 'Office nonce read-only catalog verification passed; multi-session concurrency was not executed';
END;
$office_nonce_ci$;
