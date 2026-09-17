-- ============================================================
-- 084_chat_foundation.sql — internal chat (Fase 1: text channels)
--
-- Adds a Discord-style internal chat for the account's own team
-- (not customer-facing, unrelated to the WhatsApp inbox). Scope is
-- deliberately text-only for this migration — voice channels are a
-- separate future project (self-hosted WebRTC/LiveKit), and are not
-- modeled here at all.
--
-- Access model
--
--   Unlike Comercial/Operational (Cargos+Permissões environment
--   grant) or Financeiro (owner-only), Chat has NO environment gate:
--   every account member can reach it, regardless of which cargo/
--   environments they hold. Public channels are visible to the whole
--   account; private channels need an explicit chat_channel_members
--   row. Fine-grained per-role chat permissions (who can mute/move/
--   manage) are intentionally NOT part of this migration — Fase 1
--   uses the coarse existing account_role_enum (admin+ can rename/
--   archive a channel or delete anyone's message; everyone else can
--   create public channels, post, and edit/delete their own
--   messages). Migrating to Cargos+Permissões is a natural later
--   step once the base feature is validated.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ---- chat_channels -------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_channels (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT,
  is_private   BOOLEAN NOT NULL DEFAULT FALSE,
  created_by   UUID NOT NULL REFERENCES profiles(id) ON DELETE SET NULL,
  archived_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_channels_account_idx
  ON chat_channels(account_id);

-- ---- chat_channel_members -------------------------------------------
-- Only populated for private channels. A public channel's members are
-- implicitly every is_account_member(account_id) — no rows needed.
CREATE TABLE IF NOT EXISTS chat_channel_members (
  channel_id  UUID NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  profile_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, profile_id)
);

-- ---- chat_messages ---------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id       UUID NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  -- Denormalized (also derivable via channel_id -> chat_channels.account_id)
  -- so RLS can check account membership in one join, matching the
  -- pattern already used by messages/conversations elsewhere.
  account_id       UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  author_id        UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content          TEXT,
  attachment_url   TEXT,
  attachment_type  TEXT,
  attachment_name  TEXT,
  reply_to_id      UUID REFERENCES chat_messages(id) ON DELETE SET NULL,
  edited_at        TIMESTAMPTZ,
  deleted_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Soft-delete (see messages/[id] DELETE route) clears both content
  -- and attachment_url, so the constraint must also accept that
  -- all-null combination once deleted_at is set.
  CONSTRAINT chat_messages_content_or_attachment
    CHECK (deleted_at IS NOT NULL OR content IS NOT NULL OR attachment_url IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS chat_messages_channel_idx
  ON chat_messages(channel_id, created_at);

-- ---- helper: can the caller see this channel? -------------------------
-- SECURITY DEFINER so it can read chat_channel_members without that
-- table needing its own broad SELECT policy (membership rows are only
-- ever read through this predicate).
CREATE OR REPLACE FUNCTION public.can_access_chat_channel(p_channel_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM chat_channels c
    WHERE c.id = p_channel_id
      AND is_account_member(c.account_id)
      AND (
        NOT c.is_private
        OR EXISTS (
          SELECT 1 FROM chat_channel_members m
          JOIN profiles p ON p.id = m.profile_id
          WHERE m.channel_id = c.id AND p.user_id = auth.uid()
        )
      )
  );
$$;

ALTER FUNCTION public.can_access_chat_channel(UUID) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.can_access_chat_channel(UUID) TO authenticated, service_role;

-- ---- RLS: chat_channels ------------------------------------------------
ALTER TABLE chat_channels ENABLE ROW LEVEL SECURITY;

-- Inlined against the row's own columns rather than calling
-- can_access_chat_channel(id) (which re-queries chat_channels by id).
-- A self-referential re-query here breaks `INSERT ... RETURNING`:
-- Postgres evaluates a table's SELECT policy on the just-inserted row
-- to authorize RETURNING, and at that point a fresh scan of the same
-- table doesn't yet see the row the current command is still inserting
-- (the command counter that makes "my own prior insert" visible to a
-- plain scan hasn't advanced for this check), so the re-query finds
-- nothing and RETURNING fails with "new row violates row-level
-- security policy" even though the INSERT itself was allowed. Reading
-- the row's own account_id/is_private columns directly sidesteps this
-- entirely — no table scan is involved. chat_messages/
-- chat_channel_members don't have this problem: their policies call
-- can_access_chat_channel to check a DIFFERENT (already-committed)
-- chat_channels row, not the table being inserted into.
DROP POLICY IF EXISTS chat_channels_select ON chat_channels;
CREATE POLICY chat_channels_select ON chat_channels FOR SELECT
  USING (
    is_account_member(account_id)
    AND (
      NOT is_private
      OR EXISTS (
        SELECT 1 FROM chat_channel_members m
        JOIN profiles p ON p.id = m.profile_id
        WHERE m.channel_id = chat_channels.id AND p.user_id = auth.uid()
      )
    )
  );

-- Any account member can create a public channel; private channels are
-- also caller-creatable (they add members afterwards via the API).
DROP POLICY IF EXISTS chat_channels_insert ON chat_channels;
CREATE POLICY chat_channels_insert ON chat_channels FOR INSERT
  WITH CHECK (
    is_account_member(account_id)
    AND created_by IN (SELECT id FROM profiles WHERE user_id = auth.uid())
  );

-- Rename/archive restricted to admin+ (Fase 1's coarse role model).
DROP POLICY IF EXISTS chat_channels_update ON chat_channels;
CREATE POLICY chat_channels_update ON chat_channels FOR UPDATE
  USING (is_account_member(account_id, 'admin'));

DROP POLICY IF EXISTS chat_channels_delete ON chat_channels;
CREATE POLICY chat_channels_delete ON chat_channels FOR DELETE
  USING (is_account_member(account_id, 'admin'));

-- ---- RLS: chat_channel_members ------------------------------------------
ALTER TABLE chat_channel_members ENABLE ROW LEVEL SECURITY;

-- A member can see the membership list of a channel they can access.
DROP POLICY IF EXISTS chat_channel_members_select ON chat_channel_members;
CREATE POLICY chat_channel_members_select ON chat_channel_members FOR SELECT
  USING (public.can_access_chat_channel(channel_id));

-- Adding/removing members is admin+ or the channel creator.
DROP POLICY IF EXISTS chat_channel_members_insert ON chat_channel_members;
CREATE POLICY chat_channel_members_insert ON chat_channel_members FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM chat_channels c
      WHERE c.id = channel_id
        AND (
          is_account_member(c.account_id, 'admin')
          OR c.created_by IN (SELECT id FROM profiles WHERE user_id = auth.uid())
        )
    )
  );

DROP POLICY IF EXISTS chat_channel_members_delete ON chat_channel_members;
CREATE POLICY chat_channel_members_delete ON chat_channel_members FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM chat_channels c
      WHERE c.id = channel_id
        AND (
          is_account_member(c.account_id, 'admin')
          OR c.created_by IN (SELECT id FROM profiles WHERE user_id = auth.uid())
        )
    )
  );

-- ---- RLS: chat_messages --------------------------------------------------
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_messages_select ON chat_messages;
CREATE POLICY chat_messages_select ON chat_messages FOR SELECT
  USING (public.can_access_chat_channel(channel_id));

DROP POLICY IF EXISTS chat_messages_insert ON chat_messages;
CREATE POLICY chat_messages_insert ON chat_messages FOR INSERT
  WITH CHECK (
    public.can_access_chat_channel(channel_id)
    AND author_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
  );

-- Edit/soft-delete: the author, or admin+ (moderation).
DROP POLICY IF EXISTS chat_messages_update ON chat_messages;
CREATE POLICY chat_messages_update ON chat_messages FOR UPDATE
  USING (
    author_id IN (SELECT id FROM profiles WHERE user_id = auth.uid())
    OR is_account_member(account_id, 'admin')
  );

-- ---- realtime -------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'chat_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'chat_channels'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE chat_channels;
  END IF;
END $$;
