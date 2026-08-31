-- ============================================================
-- 043_deal_extras.sql — Lost reason, deal custom fields, service
-- catalog
--
-- Backs three follow-up features on the Pipeline work:
--   - `deals.lost_reason` — captured when a deal is marked Lost, for
--     a future "why we lose" report.
--   - Deal-scoped custom fields: `custom_fields` gains `entity_type`
--     ('contact' | 'deal') so the existing field-definition catalogue
--     and its admin UI can be reused instead of building a parallel
--     one; `deal_custom_values` mirrors `contact_custom_values`.
--   - `service_catalog` — reusable mensal/pontual line-item templates
--     so "Adicionar lançamento" doesn't require retyping the same
--     service name/value every time.
--
-- RLS mirrors the existing sibling tables exactly:
--   custom_fields (already migration 017)     — select any member,
--     write admin+ (settings-class) — unchanged, just gains a column.
--   deal_custom_values mirrors contact_custom_values (017) — select
--     any member, write agent+, scoped through the parent row's
--     account.
--   service_catalog mirrors deals (017) — select any member, write
--     agent+.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS lost_reason text;

-- ---- custom_fields: add entity_type ---------------------------------
ALTER TABLE custom_fields
  ADD COLUMN IF NOT EXISTS entity_type text NOT NULL DEFAULT 'contact';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'custom_fields_entity_type_check'
  ) THEN
    ALTER TABLE custom_fields
      ADD CONSTRAINT custom_fields_entity_type_check
      CHECK (entity_type IN ('contact', 'deal'));
  END IF;
END $$;

-- ---- deal_custom_values ----------------------------------------------
CREATE TABLE IF NOT EXISTS deal_custom_values (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id         uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  custom_field_id uuid NOT NULL REFERENCES custom_fields(id) ON DELETE CASCADE,
  value           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (deal_id, custom_field_id)
);
CREATE INDEX IF NOT EXISTS idx_deal_custom_values_deal ON deal_custom_values(deal_id);

ALTER TABLE deal_custom_values ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deal_custom_values_select ON deal_custom_values;
CREATE POLICY deal_custom_values_select ON deal_custom_values FOR SELECT USING (
  EXISTS (SELECT 1 FROM deals d WHERE d.id = deal_custom_values.deal_id AND is_account_member(d.account_id))
);
DROP POLICY IF EXISTS deal_custom_values_modify ON deal_custom_values;
CREATE POLICY deal_custom_values_modify ON deal_custom_values FOR ALL USING (
  EXISTS (SELECT 1 FROM deals d WHERE d.id = deal_custom_values.deal_id AND is_account_member(d.account_id, 'agent'))
) WITH CHECK (
  EXISTS (SELECT 1 FROM deals d WHERE d.id = deal_custom_values.deal_id AND is_account_member(d.account_id, 'agent'))
);

-- ---- service_catalog ----------------------------------------------
CREATE TABLE IF NOT EXISTS service_catalog (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name          text NOT NULL,
  type          text NOT NULL CHECK (type IN ('mensal', 'pontual')),
  default_value numeric NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_service_catalog_account ON service_catalog(account_id);

ALTER TABLE service_catalog ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_catalog_select ON service_catalog;
CREATE POLICY service_catalog_select ON service_catalog FOR SELECT
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS service_catalog_insert ON service_catalog;
CREATE POLICY service_catalog_insert ON service_catalog FOR INSERT
  WITH CHECK (is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS service_catalog_update ON service_catalog;
CREATE POLICY service_catalog_update ON service_catalog FOR UPDATE
  USING (is_account_member(account_id, 'agent'));
DROP POLICY IF EXISTS service_catalog_delete ON service_catalog;
CREATE POLICY service_catalog_delete ON service_catalog FOR DELETE
  USING (is_account_member(account_id, 'agent'));
