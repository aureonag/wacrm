-- ============================================================
-- 085_deal_closing_sheet.sql — Ficha de fechamento (Fase 1)
--
-- Regra de negocio: um negocio so vira "ganho" depois que o vendedor
-- preenche a ficha de fechamento. Ao concluir a ficha, tudo acontece
-- de uma vez, numa unica transacao (RPC close_deal_with_sheet):
--   - a ficha e gravada;
--   - o negocio vira 'won';
--   - nasce a tarefa de kickoff no quadro escolhido (sem NENHUM valor
--     monetario no briefing — o Operacional nao ve valor de contrato);
--   - o responsavel pela tarefa e os donos da conta sao notificados.
--
-- Design notes
--   - A trava e no banco (trigger BEFORE UPDATE OF status em deals),
--     nao so na tela: qualquer caminho que tente marcar 'won' sem ficha
--     recebe erro. Por isso handle_contract_signed() (054) e reescrita
--     aqui — ela marcava o negocio como 'won' sozinha na assinatura, o
--     que agora seria barrado (e derrubaria a gravacao da assinatura).
--     Agora a assinatura so move o negocio para "Contrato fechado" e
--     avisa o vendedor para preencher a ficha.
--   - handle_deal_won() (070) deixa de criar a tarefa de kickoff: quem
--     cria e a RPC, que conhece quadro/observacoes/escopo escolhidos na
--     ficha. O trigger continua so notificando o responsavel do negocio.
--   - deal_closing_sheets nao tem policy de escrita para authenticated:
--     so a RPC (SECURITY DEFINER) grava. Leitura para membros da conta.
--   - O montador do briefing (com o escopo extraido do contrato) roda no
--     servidor (TypeScript) e chega aqui pronto em p_briefing.
--   - A Fase 2 acrescenta as colunas de faturamento a esta mesma ficha.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ---- ficha --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS deal_closing_sheets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  deal_id      uuid NOT NULL UNIQUE REFERENCES deals(id) ON DELETE CASCADE,
  board_id     uuid REFERENCES boards(id) ON DELETE SET NULL,
  sector_id    uuid REFERENCES sectors(id) ON DELETE SET NULL,
  assignee_id  uuid REFERENCES profiles(id) ON DELETE SET NULL,
  observations text,
  task_id      uuid REFERENCES tasks(id) ON DELETE SET NULL,
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deal_closing_sheets_account ON deal_closing_sheets(account_id);

ALTER TABLE deal_closing_sheets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deal_closing_sheets_select ON deal_closing_sheets;
CREATE POLICY deal_closing_sheets_select ON deal_closing_sheets FOR SELECT
  USING (is_account_member(account_id));

-- ---- trava: sem ficha nao vira ganho -----------------------------------
CREATE OR REPLACE FUNCTION require_closing_sheet_before_won()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'won'
     AND OLD.status IS DISTINCT FROM 'won'
     AND NOT EXISTS (SELECT 1 FROM deal_closing_sheets WHERE deal_id = NEW.id) THEN
    RAISE EXCEPTION 'A ficha de fechamento precisa ser preenchida antes de marcar o negocio como ganho'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS require_closing_sheet_before_won ON deals;
CREATE TRIGGER require_closing_sheet_before_won
  BEFORE UPDATE OF status ON deals
  FOR EACH ROW
  EXECUTE FUNCTION require_closing_sheet_before_won();

-- ---- assinatura do contrato: nao marca mais como ganho -----------------
CREATE OR REPLACE FUNCTION public.handle_contract_signed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deal deals%ROWTYPE;
  v_stage_id uuid;
  v_notify_user_id uuid;
BEGIN
  IF NEW.status IS DISTINCT FROM 'signed' OR OLD.status IS NOT DISTINCT FROM 'signed' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_deal FROM deals WHERE id = NEW.deal_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_stage_id
  FROM pipeline_stages
  WHERE pipeline_id = v_deal.pipeline_id AND kind = 'contract_closed';

  IF v_stage_id IS NULL THEN
    RAISE WARNING 'handle_contract_signed: no "Contrato fechado" stage found for pipeline %, deal % left in place', v_deal.pipeline_id, v_deal.id;
  ELSE
    UPDATE deals SET stage_id = v_stage_id WHERE id = v_deal.id;

    INSERT INTO deal_activities (deal_id, account_id, user_id, type, title, detail)
    VALUES (
      v_deal.id,
      v_deal.account_id,
      NULL,
      'contract_signed',
      'Contrato assinado',
      'Negócio movido automaticamente para "Contrato fechado". Preencha a ficha de fechamento para marcá-lo como Ganho.'
    );
  END IF;

  SELECT p.user_id INTO v_notify_user_id
  FROM profiles p WHERE p.id = v_deal.assigned_to;

  IF v_notify_user_id IS NULL THEN
    v_notify_user_id := v_deal.user_id;
  END IF;

  IF v_notify_user_id IS NOT NULL THEN
    INSERT INTO notifications (account_id, user_id, type, deal_id, contract_id, title, body)
    VALUES (
      v_deal.account_id,
      v_notify_user_id,
      'contract_signed',
      v_deal.id,
      NEW.id,
      'Contrato assinado',
      'O contrato de "' || v_deal.title || '" foi assinado. Preencha a ficha de fechamento para concluir o ganho.'
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let this automation block the signature itself from recording.
  RAISE WARNING 'handle_contract_signed failed for contract %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_contract_signed() OWNER TO postgres;

-- ---- handle_deal_won: so notifica; a tarefa nasce na RPC ----------------
CREATE OR REPLACE FUNCTION handle_deal_won()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_notify_user_id uuid;
BEGIN
  IF NEW.status IS DISTINCT FROM 'won' OR OLD.status IS NOT DISTINCT FROM 'won' THEN
    RETURN NEW;
  END IF;

  SELECT p.user_id INTO v_notify_user_id FROM profiles p WHERE p.id = NEW.assigned_to;
  IF v_notify_user_id IS NOT NULL
     AND (auth.uid() IS NULL OR auth.uid() <> v_notify_user_id)
     AND notification_enabled(v_notify_user_id, 'deal_won') THEN
    INSERT INTO notifications (account_id, user_id, type, deal_id, actor_user_id, title, body)
    VALUES (NEW.account_id, v_notify_user_id, 'deal_won', NEW.id, auth.uid(), 'Negocio ganho', NEW.title);
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'handle_deal_won falhou para o negocio %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

-- ---- RPC: concluir a ficha e fechar o negocio ---------------------------
CREATE OR REPLACE FUNCTION close_deal_with_sheet(
  p_deal_id      uuid,
  p_board_id     uuid,
  p_sector_id    uuid,
  p_assignee_id  uuid,
  p_observations text,
  p_briefing     jsonb,
  p_checklist    text[]
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_deal        deals%ROWTYPE;
  v_stage_id    uuid;
  v_task_id     uuid;
  v_position    int;
  v_due_date    date;
  v_title       text;
  v_assignee_user_id uuid;
  v_assigned_user_id uuid;
  v_owner       record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v_deal FROM deals WHERE id = p_deal_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'deal not found';
  END IF;
  IF NOT is_account_member(v_deal.account_id, 'agent') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF v_deal.status <> 'open' THEN
    RAISE EXCEPTION 'deal is not open';
  END IF;
  IF p_sector_id IS NULL THEN
    RAISE EXCEPTION 'sector is required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM boards WHERE id = p_board_id AND account_id = v_deal.account_id) THEN
    RAISE EXCEPTION 'invalid board';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM sectors WHERE id = p_sector_id AND account_id = v_deal.account_id) THEN
    RAISE EXCEPTION 'invalid sector';
  END IF;
  IF p_assignee_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_assignee_id AND account_id = v_deal.account_id) THEN
    RAISE EXCEPTION 'invalid assignee';
  END IF;

  SELECT id INTO v_stage_id FROM board_stages WHERE board_id = p_board_id ORDER BY position LIMIT 1;
  IF v_stage_id IS NULL THEN
    RAISE EXCEPTION 'board has no stages';
  END IF;

  SELECT COALESCE(MAX(position), -1) + 1 INTO v_position FROM tasks WHERE stage_id = v_stage_id;

  SELECT CASE WHEN due_offset_days IS NOT NULL THEN CURRENT_DATE + due_offset_days END
    INTO v_due_date
    FROM operational_handoff_defaults WHERE account_id = v_deal.account_id;

  v_title := 'Kickoff - ' || v_deal.title;

  INSERT INTO tasks (
    account_id, board_id, stage_id, title, contact_id, sector_id, assignee_id,
    briefing, position, due_date, created_by, deal_id
  ) VALUES (
    v_deal.account_id, p_board_id, v_stage_id, v_title, v_deal.contact_id, p_sector_id, p_assignee_id,
    p_briefing, v_position, v_due_date, auth.uid(), v_deal.id
  )
  RETURNING id INTO v_task_id;

  IF p_checklist IS NOT NULL THEN
    INSERT INTO task_checklist_items (task_id, account_id, label, position)
    SELECT v_task_id, v_deal.account_id, item.label, item.ord - 1
    FROM unnest(p_checklist) WITH ORDINALITY AS item(label, ord)
    WHERE btrim(item.label) <> '';
  END IF;

  INSERT INTO deal_closing_sheets (
    account_id, deal_id, board_id, sector_id, assignee_id, observations, task_id, created_by
  ) VALUES (
    v_deal.account_id, v_deal.id, p_board_id, p_sector_id, p_assignee_id,
    NULLIF(btrim(COALESCE(p_observations, '')), ''), v_task_id, auth.uid()
  );

  UPDATE deals
  SET status = 'won',
      handoff_sector_id = p_sector_id,
      handoff_assignee_id = p_assignee_id
  WHERE id = v_deal.id;

  INSERT INTO deal_activities (deal_id, account_id, user_id, type, title, detail)
  VALUES (
    v_deal.id, v_deal.account_id, auth.uid(), 'closing_sheet',
    'Negócio fechado',
    'Ficha de fechamento preenchida e tarefa de kickoff criada no Operacional.'
  );

  -- Quem vai tocar a tarefa.
  IF p_assignee_id IS NOT NULL THEN
    SELECT user_id INTO v_assignee_user_id FROM profiles WHERE id = p_assignee_id;
    PERFORM emit_task_notification(v_task_id, v_assignee_user_id, 'kickoff_task_created', 'Tarefa de kickoff criada', v_title);
  END IF;

  -- Aviso de "novo fechamento" para os donos (sem aprovacao). Quem ja
  -- recebe o aviso de "negocio ganho" do trigger nao recebe em dobro.
  SELECT user_id INTO v_assigned_user_id FROM profiles WHERE id = v_deal.assigned_to;
  FOR v_owner IN
    SELECT user_id FROM profiles
    WHERE account_id = v_deal.account_id
      AND account_role = 'owner'
      AND user_id IS NOT NULL
      AND user_id <> auth.uid()
      AND user_id IS DISTINCT FROM v_assigned_user_id
  LOOP
    IF notification_enabled(v_owner.user_id, 'deal_won') THEN
      INSERT INTO notifications (account_id, user_id, type, deal_id, actor_user_id, title, body)
      VALUES (v_deal.account_id, v_owner.user_id, 'deal_won', v_deal.id, auth.uid(), 'Novo fechamento', v_deal.title);
    END IF;
  END LOOP;

  RETURN v_task_id;
END;
$$;

REVOKE ALL ON FUNCTION close_deal_with_sheet(uuid, uuid, uuid, uuid, text, jsonb, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION close_deal_with_sheet(uuid, uuid, uuid, uuid, text, jsonb, text[]) TO authenticated;
