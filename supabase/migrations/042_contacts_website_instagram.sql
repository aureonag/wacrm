-- ============================================================
-- 042_contacts_website_instagram.sql — Site/Instagram on contacts
--
-- Backs the deal detail page's "Contato principal" card, which now
-- shows a contact's website and Instagram handle alongside phone/
-- email (matching the mockup). Both nullable, free text — no format
-- validation, same as the existing `company` column.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS website text,
  ADD COLUMN IF NOT EXISTS instagram text;
