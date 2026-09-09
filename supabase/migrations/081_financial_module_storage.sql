-- ============================================================
-- 081_financial_module_storage.sql
--
-- Adds the `fin-receipts` Supabase Storage bucket for the Financeiro
-- module's comprovante uploads (PIX/boleto proofs). PRIVATE, like
-- `contracts` (053) — these are the owner's private financial records,
-- so reads/writes are scoped to the OWNER role specifically, not just
-- account membership (unlike contracts, which any member can read).
--
-- Path convention: fin-receipts/account-<account_id>/<timestamp>-<name>.<ext>
--
-- Size limit 10 MB — generous for a photographed/screenshotted receipt
-- or a one-page PDF boleto.
--
-- Idempotent — safe to re-run.
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'fin-receipts',
  'fin-receipts',
  FALSE,
  10485760, -- 10 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Owner can read fin-receipts" ON storage.objects;
CREATE POLICY "Owner can read fin-receipts"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'fin-receipts'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_role = 'owner'
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Owner can upload fin-receipts" ON storage.objects;
CREATE POLICY "Owner can upload fin-receipts"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'fin-receipts'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_role = 'owner'
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Owner can delete fin-receipts" ON storage.objects;
CREATE POLICY "Owner can delete fin-receipts"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'fin-receipts'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_role = 'owner'
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );
