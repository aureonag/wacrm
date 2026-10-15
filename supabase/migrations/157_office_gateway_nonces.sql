-- Shared replay protection for the server-to-server office store callback.
-- No browser role may inspect nonce records; the only entry point is this bounded RPC.
-- This migration contains no keys, runtime snapshots, seed imports or network calls.
CREATE SCHEMA IF NOT EXISTS office_private AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA office_private FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS office_private.gateway_nonces (
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  nonce text NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT office_gateway_nonces_pkey PRIMARY KEY (account_id, nonce),
  CONSTRAINT office_gateway_nonces_aureon_only CHECK (
    account_id = '737433a3-ec29-4e90-b4ba-9989192ca735'::uuid
  ),
  CONSTRAINT office_gateway_nonces_nonce_format CHECK (nonce ~ '^[0-9a-f]{32}$')
);
CREATE INDEX IF NOT EXISTS office_gateway_nonces_expiry
  ON office_private.gateway_nonces(account_id, expires_at);
ALTER TABLE office_private.gateway_nonces OWNER TO postgres;
ALTER TABLE office_private.gateway_nonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE office_private.gateway_nonces FORCE ROW LEVEL SECURITY;
-- FORCE RLS with no policy is deliberate defense in depth, including for service_role.
REVOKE ALL ON TABLE office_private.gateway_nonces FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.office_gateway_claim_nonce(
  p_account_id uuid,
  p_nonce text,
  p_issued_at_ms bigint
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  v_now timestamptz;
  v_now_ms bigint;
  v_claimed boolean;
BEGIN
  IF p_account_id IS DISTINCT FROM '737433a3-ec29-4e90-b4ba-9989192ca735'::uuid THEN
    RAISE EXCEPTION 'Office access is restricted' USING ERRCODE = '42501';
  END IF;
  IF p_nonce IS NULL OR p_nonce !~ '^[0-9a-f]{32}$'
    OR p_issued_at_ms IS NULL OR p_issued_at_ms < 0
    OR p_issued_at_ms > 9007199254740991 THEN
    RAISE EXCEPTION 'Invalid office gateway request' USING ERRCODE = '22023';
  END IF;
  -- A caller with an older repeatable-read snapshot could otherwise bypass the live cap.
  -- PostgREST RPCs use read committed; reject other isolation levels rather than weaken it.
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Unsupported office gateway transaction' USING ERRCODE = '22023';
  END IF;

  -- Dedicated two-int advisory namespace (AUGW, migration157), fixed Aureon account only.
  -- Held until transaction end: all claims/cleanup/cap checks serialize across workers.
  PERFORM pg_advisory_xact_lock(1096107863, 157);
  -- Check wall clock AFTER acquiring the lock, including time spent waiting for a claim.
  v_now := clock_timestamp();
  v_now_ms := floor(extract(epoch FROM v_now) * 1000)::bigint;
  IF abs(v_now_ms - p_issued_at_ms) >= 60000 THEN
    RAISE EXCEPTION 'Invalid office gateway request' USING ERRCODE = '22023';
  END IF;

  DELETE FROM office_private.gateway_nonces
    WHERE account_id = p_account_id AND expires_at <= v_now;
  -- A replay stays false at capacity; never evict an unexpired nonce to admit a new one.
  IF EXISTS (SELECT 1 FROM office_private.gateway_nonces
    WHERE account_id = p_account_id AND nonce = p_nonce) THEN
    RETURN false;
  END IF;
  IF (SELECT count(*) FROM office_private.gateway_nonces
    WHERE account_id = p_account_id) >= 10000 THEN
    RAISE EXCEPTION 'Office gateway capacity unavailable' USING ERRCODE = '54000';
  END IF;

  INSERT INTO office_private.gateway_nonces(account_id, nonce, expires_at)
    VALUES (p_account_id, p_nonce, v_now + interval '120 seconds')
    ON CONFLICT (account_id, nonce) DO NOTHING
    RETURNING true INTO v_claimed;
  RETURN COALESCE(v_claimed, false);
END;
$$;

ALTER FUNCTION public.office_gateway_claim_nonce(uuid, text, bigint) OWNER TO postgres;
-- Also remove direct Supabase default grants, not only the PostgreSQL PUBLIC grant.
REVOKE ALL ON FUNCTION public.office_gateway_claim_nonce(uuid, text, bigint)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.office_gateway_claim_nonce(uuid, text, bigint) TO service_role;
