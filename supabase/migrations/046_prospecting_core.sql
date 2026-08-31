-- ============================================================
-- 046_prospecting_core.sql — Prospecção: conversations, messages, runs
--
-- Backs the new "Prospecção" module: a chat-driven AI agent that helps
-- a user describe a B2B company search, then runs that search as a
-- resumable background job (`prospecting_runs`), independent of the
-- chat connection staying open.
--
-- Design notes
--   - `prospecting_conversations` holds the user's current chat +
--     selections (pipeline/owner/frente/quantity) — one thread per
--     prospecting session, mirrors `automation_logs`'s "one row per
--     run, keep appending" shape but for a chat instead of steps.
--   - `prospecting_messages` is an append-only chat transcript,
--     account_id denormalized off the conversation (same reasoning as
--     `ai_knowledge_chunks.account_id` being denormalized off
--     `document_id`) so RLS and the engine never need a join to scope
--     a row to a tenant.
--   - `prospecting_runs` is the resumable background-job table for the
--     actual company search (queued -> searching -> enriching ->
--     scoring -> awaiting_review -> importing -> completed |
--     partially_completed | failed | cancelled). It is RLS-enabled
--     with a SELECT policy (the review UI reads it directly via the
--     RLS-scoped client) but NO insert/update policy — like
--     `automation_pending_executions` (migration 006), only the
--     service-role engine/cron may write it.
--   - `claimed_until` is a lease column: the cron sweep claims a row by
--     conditionally setting `claimed_until = now() + interval` so two
--     overlapping cron ticks can't both advance the same run. This is
--     a deliberate variant of automations' binary pending/running claim
--     (migration 006/`automation_pending_executions.status`) — a
--     10-state resumable run doesn't fit a two-value claim column.
--
-- RLS
--   conversations/messages: any account member (viewer+) reads;
--   agent+ writes (operational data the user creates by chatting,
--   same tier as `deal_tags`/`deal_comments`, not settings-class).
--   runs: any member reads; writes are service-role only.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ---- prospecting_conversations -------------------------------------
CREATE TABLE IF NOT EXISTS prospecting_conversations (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id              uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id                 uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  title                   text,
  selected_pipeline_id    uuid REFERENCES pipelines(id) ON DELETE SET NULL,
  selected_owner_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  selected_frente_leadgen boolean NOT NULL DEFAULT false,
  selected_frente_avr     boolean NOT NULL DEFAULT false,
  requested_quantity      integer,
  openai_conversation_id  text,
  openai_response_id      text,
  status                  text NOT NULL DEFAULT 'active'
                            CHECK (status IN ('active', 'archived')),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prospecting_conversations_account
  ON prospecting_conversations(account_id, created_at DESC);

ALTER TABLE prospecting_conversations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prospecting_conversations_select ON prospecting_conversations;
CREATE POLICY prospecting_conversations_select ON prospecting_conversations FOR SELECT
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS prospecting_conversations_insert ON prospecting_conversations;
CREATE POLICY prospecting_conversations_insert ON prospecting_conversations FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS prospecting_conversations_update ON prospecting_conversations;
CREATE POLICY prospecting_conversations_update ON prospecting_conversations FOR UPDATE
  USING (is_account_member(account_id, 'agent'));

CREATE OR REPLACE FUNCTION public.update_prospecting_conversations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prospecting_conversations_updated_at ON prospecting_conversations;
CREATE TRIGGER prospecting_conversations_updated_at
  BEFORE UPDATE ON prospecting_conversations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_prospecting_conversations_updated_at();

-- ---- prospecting_messages -------------------------------------------
CREATE TABLE IF NOT EXISTS prospecting_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES prospecting_conversations(id) ON DELETE CASCADE,
  account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content         text,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prospecting_messages_conversation
  ON prospecting_messages(conversation_id, created_at);

ALTER TABLE prospecting_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prospecting_messages_select ON prospecting_messages;
CREATE POLICY prospecting_messages_select ON prospecting_messages FOR SELECT
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS prospecting_messages_insert ON prospecting_messages;
CREATE POLICY prospecting_messages_insert ON prospecting_messages FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
-- No UPDATE/DELETE policy — append-only chat transcript, matching
-- `deal_activities`' immutability precedent.

-- ---- prospecting_runs -------------------------------------------------
CREATE TABLE IF NOT EXISTS prospecting_runs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id    uuid REFERENCES prospecting_conversations(id) ON DELETE SET NULL,
  account_id         uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  user_id            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  prompt             text NOT NULL,
  parsed_request     jsonb NOT NULL DEFAULT '{}'::jsonb,
  pipeline_id        uuid NOT NULL REFERENCES pipelines(id) ON DELETE RESTRICT,
  entry_stage_id     uuid NOT NULL REFERENCES pipeline_stages(id) ON DELETE RESTRICT,
  assigned_to        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  frente_leadgen     boolean NOT NULL DEFAULT false,
  frente_avr         boolean NOT NULL DEFAULT false,
  requested_quantity integer NOT NULL CHECK (requested_quantity BETWEEN 1 AND 50),
  status             text NOT NULL DEFAULT 'queued'
                       CHECK (status IN (
                         'queued', 'searching', 'enriching', 'scoring',
                         'awaiting_review', 'importing', 'completed',
                         'partially_completed', 'failed', 'cancelled'
                       )),
  found_count        integer NOT NULL DEFAULT 0,
  validated_count     integer NOT NULL DEFAULT 0,
  duplicate_count    integer NOT NULL DEFAULT 0,
  imported_count     integer NOT NULL DEFAULT 0,
  progress           jsonb NOT NULL DEFAULT '{}'::jsonb,
  claimed_until      timestamptz,
  error              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  completed_at       timestamptz
);
CREATE INDEX IF NOT EXISTS idx_prospecting_runs_account
  ON prospecting_runs(account_id, created_at DESC);
-- The cron sweep only ever looks at non-terminal, non-awaiting-review
-- rows — this partial index keeps that scan cheap regardless of how
-- many completed/awaiting runs an account accumulates over time.
CREATE INDEX IF NOT EXISTS idx_prospecting_runs_claimable
  ON prospecting_runs(status, claimed_until)
  WHERE status IN ('queued', 'searching', 'enriching', 'scoring', 'importing');

ALTER TABLE prospecting_runs ENABLE ROW LEVEL SECURITY;
-- SELECT: any member (viewer+) — the review/progress UI polls this
-- table directly via the RLS-scoped client.
DROP POLICY IF EXISTS prospecting_runs_select ON prospecting_runs;
CREATE POLICY prospecting_runs_select ON prospecting_runs FOR SELECT
  USING (is_account_member(account_id));
-- No INSERT/UPDATE/DELETE policy for `authenticated`: rows are created
-- and advanced exclusively by the service-role engine/cron, never
-- directly from the browser.

CREATE OR REPLACE FUNCTION public.update_prospecting_runs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prospecting_runs_updated_at ON prospecting_runs;
CREATE TRIGGER prospecting_runs_updated_at
  BEFORE UPDATE ON prospecting_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_prospecting_runs_updated_at();
