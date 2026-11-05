-- Reportei: templates de relatorio. Um modelo com nome diz o que entra no
-- relatorio (quais metricas, se tem grafico diario e de quais metricas, se a
-- comparacao vem ligada, texto de introducao). O relatorio guarda uma copia das
-- escolhas dentro do proprio snapshot, entao editar ou apagar o template
-- depois nao muda relatorios ja gerados.
-- Cada automacao pode apontar para um template (vazio = padrao, tudo).

CREATE TABLE IF NOT EXISTS reportei_templates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id    uuid NOT NULL REFERENCES accounts(id),
  name          text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  metrics       text[] NOT NULL,
  chart         boolean NOT NULL DEFAULT true,
  chart_metrics text[] NOT NULL DEFAULT '{}',
  compare       boolean NOT NULL DEFAULT true,
  intro         text CHECK (intro IS NULL OR char_length(intro) <= 1000),
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reportei_templates_account ON reportei_templates(account_id);

ALTER TABLE reportei_automations ADD COLUMN IF NOT EXISTS template_id uuid REFERENCES reportei_templates(id) ON DELETE SET NULL;

ALTER TABLE reportei_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reportei_templates_select ON reportei_templates;
CREATE POLICY reportei_templates_select ON reportei_templates FOR SELECT
  USING (is_account_member(account_id) AND has_permission('operational', 'tasks', 'view_tasks'));
DROP POLICY IF EXISTS reportei_templates_insert ON reportei_templates;
CREATE POLICY reportei_templates_insert ON reportei_templates FOR INSERT
  WITH CHECK (is_account_member(account_id) AND has_permission('operational', 'tasks', 'edit_boards'));
DROP POLICY IF EXISTS reportei_templates_update ON reportei_templates;
CREATE POLICY reportei_templates_update ON reportei_templates FOR UPDATE
  USING (is_account_member(account_id) AND has_permission('operational', 'tasks', 'edit_boards'));
DROP POLICY IF EXISTS reportei_templates_delete ON reportei_templates;
CREATE POLICY reportei_templates_delete ON reportei_templates FOR DELETE
  USING (is_account_member(account_id) AND has_permission('operational', 'tasks', 'edit_boards'));

DROP TRIGGER IF EXISTS set_updated_at ON reportei_templates;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON reportei_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
