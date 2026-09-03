-- ============================================================
-- 056_deal_origin_and_lost_reason_note.sql
--
-- Two additive columns on `deals`, both nullable so existing rows
-- read as "not informed" rather than a guessed value:
--
--   origin            — structured deal-source key (e.g. "referral",
--                        "metaAds") or, when the user picks "Outro"
--                        with a complement, that free text verbatim —
--                        same overload convention `lost_reason`
--                        already uses (see 043_deal_extras.sql).
--   lost_reason_note  — optional free-text observation attached to a
--                        loss, independent of which `lost_reason` key
--                        was picked (unlike the "Outro" free text,
--                        this can accompany ANY reason).
--
-- No CHECK constraint on either — the key lists live in
-- src/lib/deals/origin.ts and the deal detail page's LOST_REASON_KEYS,
-- not the database, so adding a reason/origin later never needs a
-- migration.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE deals ADD COLUMN IF NOT EXISTS origin text;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS lost_reason_note text;
