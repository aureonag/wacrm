-- ============================================================
-- 102_affiliates_storage.sql — arquivos privados do módulo Afiliados
--
-- Escopo
--   Cria o bucket PRIVADO `affiliates-docs`, onde ficam as notas fiscais e os
--   comprovantes de pagamento das comissões (aff_commissions.*_file_path).
--
-- Acesso
--   Nenhuma policy em storage.objects de propósito: sem policy, os papéis
--   anon/authenticated não leem nem gravam nada neste bucket. Todo acesso
--   passa pelas rotas de API do servidor (service_role), que verificam quem
--   é a pessoa e a que loja ela pertence antes de gerar um link temporário.
--
-- NÃO mexe em
--   nenhum outro bucket, tabela ou policy existente.
--
-- Idempotente — seguro para rodar várias vezes.
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'affiliates-docs',
  'affiliates-docs',
  FALSE,
  5242880, -- 5 MB
  ARRAY['application/pdf', 'image/png', 'image/jpeg']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
