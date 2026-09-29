-- ============================================================
-- 092_deal_comments_editable.sql — Comentários do negócio: editar
--
-- deal_comments (041) já tinha policy de UPDATE (agent+), so faltava
-- updated_at para o card mostrar "(editado)" quando o texto mudar.
-- A UI (contract-tab... digo, deal detail page) segue restringindo a
-- edição ao próprio autor; a policy continua mais ampla (qualquer
-- agent+ pode editar), igual já era para excluir.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE deal_comments ADD COLUMN IF NOT EXISTS updated_at timestamptz;

DROP TRIGGER IF EXISTS set_updated_at ON deal_comments;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON deal_comments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
