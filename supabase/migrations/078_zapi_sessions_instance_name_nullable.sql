-- ============================================================
-- The Z-API migration (077) stopped writing `instance_name` (an
-- Evolution-API-era column, app-generated instance name) -- Z-API
-- sessions are identified by zapi_instance_id/zapi_instance_token
-- instead. `instance_name` still had a NOT NULL constraint from its
-- original migration, which blocked every new Z-API connect with a
-- 23502 error (confirmed live on Allan's first real connect attempt).
--
-- Left in place, unused, nullable -- same rollback-safety-net
-- reasoning as keeping the column itself (see migration 077).
-- ============================================================

ALTER TABLE whatsapp_sessions
  ALTER COLUMN instance_name DROP NOT NULL;
