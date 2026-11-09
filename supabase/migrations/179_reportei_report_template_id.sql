-- Reportei: qual template gerou cada relatorio (id "builtin:..." ou uuid do template),
-- para contar os usos de cada template na tela de Templates.
ALTER TABLE reportei_reports ADD COLUMN IF NOT EXISTS template_id text;
CREATE INDEX IF NOT EXISTS idx_reportei_reports_template ON reportei_reports(account_id, template_id) WHERE template_id IS NOT NULL;
