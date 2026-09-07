-- ============================================================
-- History-import chats gain the chat's own name/avatar, captured at
-- queue time from Evolution API's findChats. Verified live against
-- the deployed instance: for a group, findChats' pushName IS the
-- group subject and profilePicUrl IS the group photo -- data the
-- worker previously discarded, which is why every imported group
-- landed named by its raw numeric id with no avatar. Also useful as
-- a fallback name/avatar source for 1:1 numbers that never made it
-- into Baileys' saved-contacts store (findContacts).
-- ============================================================

ALTER TABLE whatsapp_history_import_chats
  ADD COLUMN IF NOT EXISTS chat_name TEXT,
  ADD COLUMN IF NOT EXISTS chat_avatar_url TEXT;
