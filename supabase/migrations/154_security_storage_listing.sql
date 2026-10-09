-- ============================================================
-- 154_security_storage_listing.sql — acaba com a LISTAGEM anônima de
-- chat-media e flow-media (achado F04, parte segura, 2026-10-08).
--
-- Problema
--   As policies SELECT "publicly readable" filtram só por bucket_id, para
--   qualquer papel: anon consegue LISTAR todas as pastas (account-<uuid>/...)
--   e arquivos. Isso também entrega os ids de conta usados em F01.
--
-- Correção mínima, sem quebrar nada
--   * O download por URL pública (/object/public/...) NÃO usa policy de
--     SELECT em bucket público — continua funcionando (Meta/Z-API buscam
--     mídia por URL; o inbox e os fluxos exibem por getPublicUrl).
--   * A policy larga é trocada por SELECT só para membros da própria conta
--     (chat-media) / da própria conta ou usuário (flow-media), preservando
--     list/download/signed-url feitos com sessão do app.
--
-- NÃO resolvido aqui (decisão de produto): tornar os buckets privados com URL
-- assinada exige mexer em como a Meta/Z-API recebem a mídia e em mensagens
-- já enviadas. Fica no cartão de segurança.
--
-- Idempotente — seguro para rodar várias vezes.
-- ============================================================

DROP POLICY IF EXISTS "Chat media is publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "Chat media readable by account members" ON storage.objects;
CREATE POLICY "Chat media readable by account members"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'chat-media'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Flow media is publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "Flow media readable by account members" ON storage.objects;
CREATE POLICY "Flow media readable by account members"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'flow-media'
    AND (
      auth.uid()::text = (storage.foldername(name))[1]
      OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.user_id = auth.uid()
          AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
      )
    )
  );

-- Validação manual: listar chat-media com a anon key -> vazio/negado;
-- imagens do inbox e de um fluxo (URL pública) seguem abrindo.
