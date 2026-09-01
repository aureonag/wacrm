-- ============================================================
-- 053_contracts_storage.sql
--
-- Adds the `contracts` Supabase Storage bucket used by the Contrato
-- feature to hold the generated PDF sent to Clicksign and the final
-- signed PDF Clicksign returns via webhook. The virtual-acceptance
-- path never touches this bucket — `deal_contracts.rendered_content`
-- plus the acceptance metadata (ip/timestamp/user agent) is the record
-- for that method.
--
-- Unlike `chat-media` (023) and `flow-media` (016/020), this bucket is
-- PRIVATE: these are signed legal documents, not Meta-fetched links,
-- so there is no reason for public read access. Downloads from the
-- CRM UI go through a signed URL (`createSignedUrl`), and SELECT on
-- `storage.objects` is scoped to account members, same as writes.
--
-- Path convention:
--   contracts/account-<account_id>/<deal_id>/<contract_id>-{generated|signed}.pdf
--
-- Size limit 10 MB — generous for a text-only legal document PDF.
--
-- Idempotent — safe to re-run.
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'contracts',
  'contracts',
  FALSE,
  10485760, -- 10 MB
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Account-scoped reads AND writes — same predicate shape as
-- chat-media's write policies (020/023), just also applied to SELECT
-- since this bucket isn't public.
DROP POLICY IF EXISTS "Members can read contracts" ON storage.objects;
CREATE POLICY "Members can read contracts"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'contracts'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Members can upload contracts" ON storage.objects;
CREATE POLICY "Members can upload contracts"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'contracts'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Members can update contracts" ON storage.objects;
CREATE POLICY "Members can update contracts"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'contracts'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Members can delete contracts" ON storage.objects;
CREATE POLICY "Members can delete contracts"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'contracts'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );
