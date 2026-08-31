-- ============================================================
-- 048_prospecting_audit.sql — Prospecção: dedicated audit trail
--
-- A scoped-to-this-module audit log (not a platform-wide generic audit
-- table — that's real, separate scope this feature doesn't need yet).
-- Records who did what (created a run, imported candidates, cancelled
-- a search) for operational visibility and support/debugging.
--
-- RLS mirrors `ai_usage_log` exactly (migration 033): admin+ read only
-- (spend/operational-audit visibility is billing/settings-class), no
-- write policy for `authenticated` — written exclusively by the
-- service-role client via `src/lib/prospecting/audit.ts`, which is the
-- single choke point responsible for sanitizing `metadata`/`error`
-- before insert (never api_key/token/authorization-header/raw provider
-- response bodies; free-text fields truncated to a fixed length).
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE TABLE IF NOT EXISTS prospecting_audit_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES prospecting_conversations(id) ON DELETE SET NULL,
  run_id          uuid REFERENCES prospecting_runs(id) ON DELETE SET NULL,
  action          text NOT NULL,
  pipeline_id     uuid REFERENCES pipelines(id) ON DELETE SET NULL,
  quantity        integer,
  provider        text,
  status          text NOT NULL,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  error           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prospecting_audit_logs_account
  ON prospecting_audit_logs(account_id, created_at DESC);

ALTER TABLE prospecting_audit_logs ENABLE ROW LEVEL SECURITY;

-- SELECT: admin+ only (matches `ai_usage_log_select` exactly).
DROP POLICY IF EXISTS prospecting_audit_logs_select ON prospecting_audit_logs;
CREATE POLICY prospecting_audit_logs_select ON prospecting_audit_logs FOR SELECT
  USING (is_account_member(account_id, 'admin'));

-- No INSERT/UPDATE/DELETE policy for `authenticated`: written
-- exclusively by the service role, never mutated from the client.
