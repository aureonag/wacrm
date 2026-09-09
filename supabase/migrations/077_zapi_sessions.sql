-- ============================================================
-- Migrates "Meu WhatsApp" from the self-hosted Evolution API to Z-API
-- (hosted, unofficial WhatsApp QR-code gateway). Z-API instances aren't
-- created by this app -- a regular (non-"integrador") account creates
-- one by hand in the Z-API dashboard, so each user's session now needs
-- to store that instance's own ID + Token instead of an
-- app-generated `instance_name`.
--
-- `instance_name` is left in place, unused going forward -- rollback
-- safety net, not destructive to remove once Z-API is validated.
-- ============================================================

ALTER TABLE whatsapp_sessions
  ADD COLUMN IF NOT EXISTS zapi_instance_id TEXT,
  ADD COLUMN IF NOT EXISTS zapi_instance_token TEXT;
