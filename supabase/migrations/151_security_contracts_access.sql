-- ============================================================
-- 151_security_contracts_access.sql — contratos só para quem tem acesso ao
-- Comercial (achados A2 e A3 da revisão de segurança, 2026-10-01).
--
-- Problema
--   * `deal_contracts` (que inclui `rendered_content`, com o valor do
--     contrato) e `deal_contract_events` eram legíveis por QUALQUER membro da
--     conta, inclusive o Operacional, direto pela REST do Supabase — a regra
--     "Operacional nunca vê valor" só valia na UI/rota.
--   * O bucket `contracts` (PDFs assinados) permitia a qualquer membro ler,
--     sobrescrever e APAGAR contratos assinados.
--
-- Correção (conservadora — não muda o que o Comercial já faz)
--   * SELECT de `deal_contracts` / `deal_contract_events`: além de ser membro,
--     exige `has_permission('comercial','pipelines','view')` (o dono sempre
--     passa). A aba Contrato fica dentro de Pipelines, então quem a usa já
--     tem essa permissão. As rotas do Operacional (contrato da tarefa,
--     clientes, sincronização) leem com service_role e não são afetadas.
--   * Bucket `contracts`: SELECT/INSERT/UPDATE para agent+ com a mesma
--     permissão (o upload com upsert da geração do PDF continua funcionando
--     para quem envia contratos); DELETE só admin+ (nenhum código apaga).
--   * INSERT/UPDATE das tabelas não mudam.
--
-- Fora deste passo (depende de separar o valor no modelo de dados):
--   `deals.value` continua legível a membros, porque o Operacional lê `deals`
--   em tarefas, kickoff e dashboard.
--
-- Idempotente — seguro para rodar várias vezes.
-- ============================================================

-- ---- deal_contracts / deal_contract_events: SELECT -----------------------
DROP POLICY IF EXISTS deal_contracts_select ON deal_contracts;
CREATE POLICY deal_contracts_select ON deal_contracts FOR SELECT
  USING (
    is_account_member(account_id)
    AND has_permission('comercial', 'pipelines', 'view')
  );

DROP POLICY IF EXISTS deal_contract_events_select ON deal_contract_events;
CREATE POLICY deal_contract_events_select ON deal_contract_events FOR SELECT
  USING (
    is_account_member(account_id)
    AND has_permission('comercial', 'pipelines', 'view')
  );

-- ---- bucket `contracts` ---------------------------------------------------
DROP POLICY IF EXISTS "Members can read contracts" ON storage.objects;
CREATE POLICY "Members can read contracts"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'contracts'
    AND public.has_permission('comercial', 'pipelines', 'view')
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_role IN ('owner', 'admin', 'agent')
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Members can upload contracts" ON storage.objects;
CREATE POLICY "Members can upload contracts"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'contracts'
    AND public.has_permission('comercial', 'pipelines', 'view')
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_role IN ('owner', 'admin', 'agent')
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

DROP POLICY IF EXISTS "Members can update contracts" ON storage.objects;
CREATE POLICY "Members can update contracts"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'contracts'
    AND public.has_permission('comercial', 'pipelines', 'view')
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.account_role IN ('owner', 'admin', 'agent')
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
        AND p.account_role IN ('owner', 'admin')
        AND ('account-' || p.account_id::text) = (storage.foldername(name))[1]
    )
  );

-- ============================================================
-- Validação manual (staging):
--   * Usuário do Operacional (cargo sem comercial:pipelines:view):
--       GET /rest/v1/deal_contracts  → []      ; /operational/clients segue ok
--   * Vendedor: aba Contrato do negócio carrega; enviar, cancelar, baixar PDF assinado ok
--   * Qualquer membro não-admin: DELETE em storage 'contracts' → negado
-- ============================================================
