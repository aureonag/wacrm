-- ============================================================
-- 072_whatsapp_sessions.sql - WhatsApp pessoal por membro do time
--
-- Complementar ao whatsapp_config existente (API oficial da Meta,
-- uma linha por conta). Aqui cada USUARIO pode conectar o proprio
-- WhatsApp escaneando um QR code ("aparelho vinculado"), via uma
-- instancia na Evolution API (servico Docker separado, fora do
-- Next.js - nao existe worker/processo persistente nesta app hoje).
--
-- Chave por auth.users.id (nao por perfil), mesma convencao de
-- member_presence (024) / notification_preferences (067):
-- eh um estado pessoal, uma linha por pessoa. account_id fica
-- denormalizado apenas para RLS; sempre resolvido server-side via
-- getCurrentAccount(), nunca vindo do cliente.
--
-- Idempotente - seguro rodar mais de uma vez.
-- ============================================================

-- ---- table ---------------------------------------------------
CREATE TABLE IF NOT EXISTS whatsapp_sessions (
  user_id       UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id    UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  instance_name TEXT NOT NULL UNIQUE,
  status        TEXT NOT NULL DEFAULT 'disconnected'
                  CHECK (status IN ('disconnected', 'connecting', 'connected')),
  phone_number  TEXT,
  connected_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_sessions_account_idx
  ON whatsapp_sessions(account_id);

DROP TRIGGER IF EXISTS set_updated_at ON whatsapp_sessions;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON whatsapp_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---- RLS -------------------------------------------------------
ALTER TABLE whatsapp_sessions ENABLE ROW LEVEL SECURITY;

-- Owner sees/manages their own row, OR an account admin can see every
-- session in the account (to know who's connected / troubleshoot).
-- Writes from the API routes always go through the service-role
-- client with account_id/user_id resolved server-side, so these
-- policies only gate what the dashboard's RLS-scoped client can read.
DROP POLICY IF EXISTS whatsapp_sessions_select_own ON whatsapp_sessions;
CREATE POLICY whatsapp_sessions_select_own ON whatsapp_sessions FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS whatsapp_sessions_select_admin ON whatsapp_sessions;
CREATE POLICY whatsapp_sessions_select_admin ON whatsapp_sessions FOR SELECT
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS whatsapp_sessions_delete_own ON whatsapp_sessions;
CREATE POLICY whatsapp_sessions_delete_own ON whatsapp_sessions FOR DELETE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS whatsapp_sessions_delete_admin ON whatsapp_sessions;
CREATE POLICY whatsapp_sessions_delete_admin ON whatsapp_sessions FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- No client INSERT/UPDATE policy: rows are created/updated only by the
-- API routes using the service-role client (creating the Evolution API
-- instance is a side effect that must happen atomically with the row).

-- ---- realtime ----------------------------------------------------
-- So the "Meu WhatsApp" settings panel can reflect status flipping to
-- 'connected' the moment the webhook records it, without polling.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'whatsapp_sessions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE whatsapp_sessions;
  END IF;
END $$;

-- ---- conversations.whatsapp_session_id --------------------------
-- Which personal connection a conversation came in through. NULL
-- means it came through the official company number (whatsapp_config)
-- - existing behavior, untouched. References whatsapp_sessions(user_id)
-- since that's the table's PK (one session per user).
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS whatsapp_session_id UUID
    REFERENCES whatsapp_sessions(user_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS conversations_whatsapp_session_idx
  ON conversations(whatsapp_session_id) WHERE whatsapp_session_id IS NOT NULL;
