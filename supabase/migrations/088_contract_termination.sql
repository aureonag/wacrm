-- ============================================================
-- 088_contract_termination.sql — Cancelamento de contrato ASSINADO
--
-- O cancelamento existente (/api/contracts/[id]/cancel, 052) so serve
-- para rascunho/enviado e recusa contrato assinado. Aqui entra o
-- cancelamento de um contrato ja assinado, feito pelo comercial na aba
-- Contrato do negocio:
--   - o contrato continua 'signed' (e um fato historico); o cancelamento
--     e registrado nas colunas terminated_* e num evento na timeline;
--   - o cliente correspondente no Financeiro (fin_clients.deal_id, 085)
--     passa para "Encerrados" com a data de efeito, o que tambem para a
--     projecao dos meses seguintes (087);
--   - a funcao e SECURITY DEFINER porque o Financeiro e so do dono
--     (080) e quem cancela e o comercial (agente).
--   O envio da minuta por e-mail e feito pela rota, depois desta funcao.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE deal_contracts
  ADD COLUMN IF NOT EXISTS terminated_at timestamptz,
  ADD COLUMN IF NOT EXISTS terminated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS termination_effective_date date,
  ADD COLUMN IF NOT EXISTS termination_note text;

ALTER TABLE deal_contract_events DROP CONSTRAINT IF EXISTS deal_contract_events_event_type_check;
ALTER TABLE deal_contract_events
  ADD CONSTRAINT deal_contract_events_event_type_check
  CHECK (event_type IN (
    'created', 'sent', 'viewed', 'signed', 'declined', 'expired', 'cancelled', 'webhook_received',
    'terminated', 'termination_email_sent', 'termination_email_failed'
  ));

CREATE OR REPLACE FUNCTION terminate_signed_contract(
  p_contract_id     uuid,
  p_effective_date  date,
  p_note            text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_contract    deal_contracts%ROWTYPE;
  v_ended       int := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v_contract FROM deal_contracts WHERE id = p_contract_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'contract not found';
  END IF;
  IF NOT is_account_member(v_contract.account_id, 'agent') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF v_contract.status <> 'signed' THEN
    RAISE EXCEPTION 'contract is not signed';
  END IF;
  IF v_contract.terminated_at IS NOT NULL THEN
    RAISE EXCEPTION 'contract already terminated';
  END IF;
  IF p_effective_date IS NULL THEN
    RAISE EXCEPTION 'effective date is required';
  END IF;
  IF v_contract.signed_at IS NOT NULL AND p_effective_date < (v_contract.signed_at::date) THEN
    RAISE EXCEPTION 'effective date before signature';
  END IF;

  UPDATE deal_contracts
  SET terminated_at = now(),
      terminated_by = auth.uid(),
      termination_effective_date = p_effective_date,
      termination_note = NULLIF(btrim(COALESCE(p_note, '')), '')
  WHERE id = v_contract.id;

  INSERT INTO deal_contract_events (contract_id, account_id, event_type, actor_user_id, metadata)
  VALUES (
    v_contract.id, v_contract.account_id, 'terminated', auth.uid(),
    jsonb_build_object('effective_date', p_effective_date, 'note', NULLIF(btrim(COALESCE(p_note, '')), ''))
  );

  -- Financeiro: os clientes criados pela ficha deste negocio vao para "Encerrados".
  WITH ended AS (
    UPDATE fin_clients
    SET status = 'ended', ended_at = p_effective_date
    WHERE deal_id = v_contract.deal_id AND status = 'active'
    RETURNING id
  )
  SELECT count(*) INTO v_ended FROM ended;

  INSERT INTO deal_activities (deal_id, account_id, user_id, type, title, detail)
  VALUES (
    v_contract.deal_id, v_contract.account_id, auth.uid(), 'contract_terminated',
    'Contrato cancelado',
    'Cancelamento do contrato assinado, com efeito a partir de ' || to_char(p_effective_date, 'DD/MM/YYYY') || '.'
  );

  RETURN jsonb_build_object('deal_id', v_contract.deal_id, 'ended_clients', v_ended);
END;
$$;

REVOKE ALL ON FUNCTION terminate_signed_contract(uuid, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION terminate_signed_contract(uuid, date, text) TO authenticated;
