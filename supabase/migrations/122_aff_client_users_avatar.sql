-- ============================================================
-- 122_aff_client_users_avatar.sql — foto das pessoas da loja (portal do cliente)
--
-- Cada pessoa da equipe de uma loja (aff_client_users) pode ter uma foto. O
-- arquivo fica no bucket publico `avatars` (pasta aff-store/<loja>/...) e esta
-- coluna guarda a URL publica. Quem envia/remove e o proprio usuario ou quem
-- tem permissao de Equipe, sempre pela API (service role) — nao ha policy nova.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE aff_client_users ADD COLUMN IF NOT EXISTS avatar_url text;
