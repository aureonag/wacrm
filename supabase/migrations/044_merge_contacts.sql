-- ============================================================
-- 044_merge_contacts.sql — merge_contacts(primary, secondary) RPC
--
-- Backs the "Contatos duplicados" tool: folds one contact into
-- another (deals, conversation + its messages, tags, notes, custom
-- field values), then deletes the loser. SECURITY DEFINER so it can
-- write across tables regardless of the caller's RLS, gated by the
-- same admin+ check pattern as `set_member_role` (migration 018).
--
-- Conversations are the one genuinely tricky part: `conversations`
-- has a UNIQUE(account_id, contact_id) index (migration 036). If both
-- contacts already have one, the secondary's conversation is merged
-- into the primary's (re-pointing messages and other conversation-
-- scoped children first) rather than just re-pointed, mirroring
-- `merge_duplicate_conversations` from that same migration.
--
-- Idempotent to (re)create — not idempotent to *run* twice with the
-- same arguments (the secondary contact is gone after the first call).
-- ============================================================

CREATE OR REPLACE FUNCTION public.merge_contacts(
  p_primary_id UUID,
  p_secondary_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
  v_secondary_account_id UUID;
  v_primary_conv UUID;
  v_secondary_conv UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  IF p_primary_id = p_secondary_id THEN
    RAISE EXCEPTION 'Cannot merge a contact into itself' USING ERRCODE = '22023';
  END IF;

  SELECT account_id INTO v_account_id FROM contacts WHERE id = p_primary_id;
  SELECT account_id INTO v_secondary_account_id FROM contacts WHERE id = p_secondary_id;

  IF v_account_id IS NULL OR v_secondary_account_id IS NULL THEN
    RAISE EXCEPTION 'Contact not found' USING ERRCODE = '22023';
  END IF;
  IF v_account_id <> v_secondary_account_id THEN
    RAISE EXCEPTION 'Contacts belong to different accounts' USING ERRCODE = '22023';
  END IF;
  IF NOT is_account_member(v_account_id, 'admin') THEN
    RAISE EXCEPTION 'Insufficient privilege' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_primary_conv FROM conversations WHERE contact_id = p_primary_id;
  SELECT id INTO v_secondary_conv FROM conversations WHERE contact_id = p_secondary_id;

  IF v_secondary_conv IS NOT NULL THEN
    IF v_primary_conv IS NOT NULL THEN
      UPDATE messages          SET conversation_id = v_primary_conv WHERE conversation_id = v_secondary_conv;
      UPDATE message_reactions SET conversation_id = v_primary_conv WHERE conversation_id = v_secondary_conv;
      UPDATE deals             SET conversation_id = v_primary_conv WHERE conversation_id = v_secondary_conv;
      UPDATE flow_runs         SET conversation_id = v_primary_conv WHERE conversation_id = v_secondary_conv;
      UPDATE notifications     SET conversation_id = v_primary_conv WHERE conversation_id = v_secondary_conv;
      UPDATE ai_usage_log      SET conversation_id = v_primary_conv WHERE conversation_id = v_secondary_conv;

      UPDATE conversations c
      SET unread_count = c.unread_count + COALESCE(s.unread_count, 0),
          last_message_text = COALESCE(lm.content_text, c.last_message_text),
          last_message_at = GREATEST(c.last_message_at, s.last_message_at),
          updated_at = now()
      FROM (SELECT unread_count, last_message_at FROM conversations WHERE id = v_secondary_conv) s
      LEFT JOIN LATERAL (
        SELECT content_text, created_at FROM messages
        WHERE conversation_id = v_primary_conv ORDER BY created_at DESC LIMIT 1
      ) lm ON true
      WHERE c.id = v_primary_conv;

      DELETE FROM conversations WHERE id = v_secondary_conv;
    ELSE
      UPDATE conversations SET contact_id = p_primary_id WHERE id = v_secondary_conv;
    END IF;
  END IF;

  -- No uniqueness constraints on these — plain re-point.
  UPDATE deals SET contact_id = p_primary_id WHERE contact_id = p_secondary_id;
  UPDATE contact_notes SET contact_id = p_primary_id WHERE contact_id = p_secondary_id;

  -- UNIQUE(contact_id, tag_id) / UNIQUE(contact_id, custom_field_id) —
  -- keep the primary's existing row on conflict, drop the secondary's.
  INSERT INTO contact_tags (contact_id, tag_id)
    SELECT p_primary_id, tag_id FROM contact_tags WHERE contact_id = p_secondary_id
    ON CONFLICT DO NOTHING;
  DELETE FROM contact_tags WHERE contact_id = p_secondary_id;

  INSERT INTO contact_custom_values (contact_id, custom_field_id, value)
    SELECT p_primary_id, custom_field_id, value FROM contact_custom_values WHERE contact_id = p_secondary_id
    ON CONFLICT (contact_id, custom_field_id) DO NOTHING;
  DELETE FROM contact_custom_values WHERE contact_id = p_secondary_id;

  DELETE FROM contacts WHERE id = p_secondary_id;
END;
$$;

ALTER FUNCTION public.merge_contacts(UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.merge_contacts(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.merge_contacts(UUID, UUID) TO authenticated;
