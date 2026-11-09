-- Reportei: linha do tempo de marketing. Marcos por cliente (uma campanha que
-- comecou, uma troca de criativo, uma promocao) que ajudam a explicar os numeros.
-- Os marcos que caem no periodo de um relatorio entram nele quando e gerado.

CREATE TABLE IF NOT EXISTS reportei_timeline_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id),
  client_id   uuid NOT NULL REFERENCES ops_clients(id) ON DELETE CASCADE,
  event_date  date NOT NULL,
  title       text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  description text CHECK (description IS NULL OR char_length(description) <= 1000),
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reportei_timeline_client_date ON reportei_timeline_events(client_id, event_date DESC);

ALTER TABLE reportei_timeline_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reportei_timeline_select ON reportei_timeline_events;
CREATE POLICY reportei_timeline_select ON reportei_timeline_events FOR SELECT
  USING (is_account_member(account_id) AND has_permission('operational', 'tasks', 'view_tasks'));
DROP POLICY IF EXISTS reportei_timeline_insert ON reportei_timeline_events;
CREATE POLICY reportei_timeline_insert ON reportei_timeline_events FOR INSERT
  WITH CHECK (is_account_member(account_id) AND has_permission('operational', 'tasks', 'edit_boards'));
DROP POLICY IF EXISTS reportei_timeline_update ON reportei_timeline_events;
CREATE POLICY reportei_timeline_update ON reportei_timeline_events FOR UPDATE
  USING (is_account_member(account_id) AND has_permission('operational', 'tasks', 'edit_boards'));
DROP POLICY IF EXISTS reportei_timeline_delete ON reportei_timeline_events;
CREATE POLICY reportei_timeline_delete ON reportei_timeline_events FOR DELETE
  USING (is_account_member(account_id) AND has_permission('operational', 'tasks', 'edit_boards'));
