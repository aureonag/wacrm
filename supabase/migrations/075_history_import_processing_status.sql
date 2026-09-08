-- ============================================================
-- Adds a 'processing' status to whatsapp_history_import_chats so the
-- worker can atomically CLAIM a batch of pending rows before working on
-- them, instead of just SELECTing whatever is 'pending'. Without this,
-- two concurrent /process loops (e.g. two open browser tabs both
-- resuming the same import) can pick up and re-do the same chats at
-- once -- wasted Evolution API calls and a needless write race on the
-- same contacts/conversations rows, even though message upserts stay
-- deduplicated either way.
-- ============================================================

ALTER TABLE whatsapp_history_import_chats
  DROP CONSTRAINT IF EXISTS whatsapp_history_import_chats_status_check;

ALTER TABLE whatsapp_history_import_chats
  ADD CONSTRAINT whatsapp_history_import_chats_status_check
    CHECK (status IN ('pending', 'processing', 'done', 'failed'));
