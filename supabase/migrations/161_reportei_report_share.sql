-- Reportei: link público (somente leitura) e revogável de um relatório salvo.
-- share_token é aleatório (32 bytes, base64url). NULL = sem link ativo; revogar
-- é voltar a NULL. A página pública lê só por service role, pelo token.

ALTER TABLE reportei_reports ADD COLUMN IF NOT EXISTS share_token text;
ALTER TABLE reportei_reports ADD COLUMN IF NOT EXISTS shared_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS idx_reportei_reports_share_token
  ON reportei_reports(share_token) WHERE share_token IS NOT NULL;
