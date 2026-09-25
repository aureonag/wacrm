-- ============================================================
-- 085_deal_closing_sheet.sql — Ficha de fechamento (Fase 1, parte compativel)
--
-- Regra de negocio: no fechamento MANUAL, o negocio so vira "ganho"
-- depois que o vendedor preenche a ficha de fechamento. Na ASSINATURA
-- do contrato o negocio continua virando ganho sozinho, mas fica com
-- closing_pending=true e um botao "Agendar kickoff" na tela, que abre
-- a mesma ficha. Ao concluir a ficha, tudo acontece de uma vez, numa
-- unica transacao (RPC close_deal_with_sheet):
--   - a ficha e gravada;
--   - o negocio vira 'won' (se ainda estava aberto);
--   - nasce a tarefa de kickoff no quadro escolhido (sem NENHUM valor
--     monetario no briefing — o Operacional nao ve valor de contrato);
--   - o responsavel pela tarefa e os donos da conta sao notificados.
--
-- Design notes
--   - Esta migracao e compativel com o codigo anterior ao deploy: nada
--     aqui impede o botao antigo de "Marcar como ganho". A TRAVA (banco
--     recusa ganho sem ficha) fica na 086, aplicada junto do deploy.
--     handle_contract_signed() (054) liga a flag de transacao
--     app.allow_win so durante o seu UPDATE (a trava da 086 a respeita)
--     e marca deals.closing_pending=true para a tela oferecer "Agendar
--     kickoff". Negocios ja ganhos antes desta migracao ficam com
--     closing_pending=false e nao recebem o aviso.
--   - handle_deal_won() (070) deixa de criar a tarefa de kickoff: quem
--     cria e a RPC, que conhece quadro/observacoes/escopo escolhidos na
--     ficha. O trigger continua so notificando o responsavel do negocio.
--   - deal_closing_sheets nao tem policy de escrita para authenticated:
--     so a RPC (SECURITY DEFINER) grava. Leitura para membros da conta.
--   - O montador do briefing (com o escopo extraido do contrato) roda no
--     servidor (TypeScript) e chega aqui pronto em p_briefing.
--   - Faturamento (Fase 2): a ficha do vendedor tambem carrega os dados
--     financeiros (linha de servico, valor, promocao, primeiro pagamento,
--     comissoes). Como as tabelas fin_* sao SO do dono (080), quem grava
--     nelas e a propria RPC (SECURITY DEFINER), na mesma transacao: cria
--     um fin_client por servico mensal (nunca soma com cliente existente),
--     os valores mes a mes ate dezembro do ano do primeiro pagamento, as
--     comissoes (fin_commissions) e soma cada comissao na despesa
--     "Comissao <nome>" do mes. Os valores NAO ficam na ficha
--     (deal_closing_sheets e legivel por todos os membros, inclusive o
--     Operacional): o snapshot vai para deal_closing_finance, so do dono.
--   - A projecao dos meses seguintes ("ate cancelar") e a Fase 3.
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

-- ---- Financeiro: rastreio do negocio nos clientes + comissoes -------------
ALTER TABLE fin_clients ADD COLUMN IF NOT EXISTS deal_id uuid REFERENCES deals(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_fin_clients_deal ON fin_clients(deal_id);

-- Snapshot dos dados financeiros declarados na ficha. Owner-only: o
-- Operacional le deal_closing_sheets e nao pode ver valores.
CREATE TABLE IF NOT EXISTS deal_closing_finance (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  sheet_id    uuid NOT NULL UNIQUE REFERENCES deal_closing_sheets(id) ON DELETE CASCADE,
  payload     jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE deal_closing_finance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deal_closing_finance_owner ON deal_closing_finance;
CREATE POLICY deal_closing_finance_owner ON deal_closing_finance FOR ALL
  USING (is_account_member(account_id, 'owner'))
  WITH CHECK (is_account_member(account_id, 'owner'));

-- Uma linha por pessoa que recebe comissao de um fechamento. O vencimento
-- e o dia do primeiro pagamento do cliente (politica: a comissao e paga no
-- dia em que o cliente paga a primeira mensalidade).
CREATE TABLE IF NOT EXISTS fin_commissions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  deal_id        uuid REFERENCES deals(id) ON DELETE SET NULL,
  profile_id     uuid REFERENCES profiles(id) ON DELETE SET NULL,
  recipient_name text NOT NULL,
  client_label   text NOT NULL,
  pct            numeric(5,2) NOT NULL,
  base_amount    numeric(12,2) NOT NULL,
  amount         numeric(12,2) NOT NULL,
  due_date       date NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fin_commissions_due ON fin_commissions(account_id, due_date);
ALTER TABLE fin_commissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fin_commissions_owner ON fin_commissions;
CREATE POLICY fin_commissions_owner ON fin_commissions FOR ALL
  USING (is_account_member(account_id, 'owner'))
  WITH CHECK (is_account_member(account_id, 'owner'));

-- "Hospedagem / Site" passa a se chamar "Criacao" (pedido do dono).
UPDATE fin_service_lines SET name = 'Criação'
WHERE name = 'Hospedagem / Site'
  AND NOT EXISTS (
    SELECT 1 FROM fin_service_lines other
    WHERE other.account_id = fin_service_lines.account_id AND other.name = 'Criação'
  );

-- ---- deals.closing_pending: ganho por assinatura aguardando o kickoff ----
ALTER TABLE deals ADD COLUMN IF NOT EXISTS closing_pending boolean NOT NULL DEFAULT false;

-- ---- assinatura do contrato: continua marcando ganho, mas pendente ------
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
    PERFORM set_config('app.allow_win', 'on', true);
    UPDATE deals SET status = 'won', stage_id = v_stage_id, closing_pending = true WHERE id = v_deal.id;
    PERFORM set_config('app.allow_win', 'off', true);

    INSERT INTO deal_activities (deal_id, account_id, user_id, type, title, detail)
    VALUES (
      v_deal.id,
      v_deal.account_id,
      NULL,
      'contract_signed',
      'Contrato assinado',
      'Negócio movido automaticamente para "Contrato fechado" e marcado como Ganho. Agende o kickoff para passar o cliente ao Operacional e ao Financeiro.'
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
      'O contrato de "' || v_deal.title || '" foi assinado. Agende o kickoff para passar o cliente ao Operacional e ao Financeiro.'
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
  p_checklist    text[],
  p_finance      jsonb DEFAULT NULL
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
  v_sheet_id    uuid;
  v_first_date  date;
  v_item        jsonb;
  v_entry       jsonb;
  v_comm        jsonb;
  v_client_id   uuid;
  v_sort        int;
  v_line_id     uuid;
  v_client_label text;
  v_base        numeric(12,2) := 0;
  v_comm_sum    numeric(12,2) := 0;
  v_recipient   text;
  v_cat_id      uuid;
  v_profile_id  uuid;
  v_amount      numeric(12,2);
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
  IF v_deal.status NOT IN ('open', 'won') THEN
    RAISE EXCEPTION 'deal is not open';
  END IF;
  IF EXISTS (SELECT 1 FROM deal_closing_sheets WHERE deal_id = v_deal.id) THEN
    RAISE EXCEPTION 'deal already closed';
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
  )
  RETURNING id INTO v_sheet_id;

  -- ---- Financeiro (so quando ha servico mensal) --------------------------
  IF p_finance IS NOT NULL AND jsonb_array_length(COALESCE(p_finance->'items', '[]'::jsonb)) > 0 THEN
    v_first_date := (p_finance->>'first_payment_date')::date;
    IF v_first_date IS NULL THEN
      RAISE EXCEPTION 'first payment date is required';
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_finance->'items') LOOP
      v_line_id := (v_item->>'service_line_id')::uuid;
      IF NOT EXISTS (SELECT 1 FROM fin_service_lines WHERE id = v_line_id AND account_id = v_deal.account_id) THEN
        RAISE EXCEPTION 'invalid service line';
      END IF;
      IF COALESCE((v_item->>'amount')::numeric, 0) <= 0 OR btrim(COALESCE(v_item->>'name', '')) = '' THEN
        RAISE EXCEPTION 'invalid finance item';
      END IF;

      SELECT COALESCE(MAX(sort_order), -1) + 1 INTO v_sort FROM fin_clients WHERE service_line_id = v_line_id;

      INSERT INTO fin_clients (account_id, service_line_id, code, name, status, started_at, sort_order, deal_id)
      VALUES (
        v_deal.account_id, v_line_id, NULLIF(btrim(COALESCE(v_item->>'code', '')), ''),
        btrim(v_item->>'name'), 'active', v_first_date, v_sort, v_deal.id
      )
      RETURNING id INTO v_client_id;

      FOR v_entry IN SELECT * FROM jsonb_array_elements(v_item->'schedule') LOOP
        IF (v_entry->>'month')::int NOT BETWEEN 1 AND 12 THEN
          RAISE EXCEPTION 'invalid schedule month';
        END IF;
        INSERT INTO fin_client_values (account_id, client_id, year, month, amount)
        VALUES (
          v_deal.account_id, v_client_id, (v_entry->>'year')::int, (v_entry->>'month')::int,
          (v_entry->>'amount')::numeric
        );
      END LOOP;

      -- primeiro mes = base da comissao (soma de todos os servicos mensais)
      v_base := v_base + COALESCE((v_item->'schedule'->0->>'amount')::numeric, 0);
    END LOOP;

    v_client_label := COALESCE(NULLIF(btrim(p_finance->>'client_label'), ''), v_deal.title);

    FOR v_comm IN SELECT * FROM jsonb_array_elements(COALESCE(p_finance->'commissions', '[]'::jsonb)) LOOP
      v_profile_id := (v_comm->>'profile_id')::uuid;
      v_amount := (v_comm->>'amount')::numeric;
      SELECT full_name INTO v_recipient FROM profiles WHERE id = v_profile_id AND account_id = v_deal.account_id;
      IF v_recipient IS NULL THEN
        RAISE EXCEPTION 'invalid commission recipient';
      END IF;
      v_comm_sum := v_comm_sum + v_amount;

      INSERT INTO fin_commissions (
        account_id, deal_id, profile_id, recipient_name, client_label, pct, base_amount, amount, due_date
      ) VALUES (
        v_deal.account_id, v_deal.id, v_profile_id, v_recipient, v_client_label,
        (v_comm->>'pct')::numeric, v_base, v_amount, v_first_date
      );

      -- soma a comissao na despesa "Comissao <primeiro nome>" do mes do pagamento
      INSERT INTO fin_expense_categories (account_id, name, is_recurring)
      VALUES (v_deal.account_id, 'Comissão ' || split_part(btrim(v_recipient), ' ', 1), true)
      ON CONFLICT (account_id, name) DO NOTHING;
      SELECT id INTO v_cat_id FROM fin_expense_categories
      WHERE account_id = v_deal.account_id AND name = 'Comissão ' || split_part(btrim(v_recipient), ' ', 1);

      INSERT INTO fin_expenses (account_id, category_id, year, month, amount, created_by)
      VALUES (
        v_deal.account_id, v_cat_id, EXTRACT(YEAR FROM v_first_date)::int, EXTRACT(MONTH FROM v_first_date)::int,
        v_amount, auth.uid()
      )
      ON CONFLICT (category_id, year, month) DO UPDATE SET amount = fin_expenses.amount + EXCLUDED.amount;
    END LOOP;

    IF jsonb_array_length(COALESCE(p_finance->'commissions', '[]'::jsonb)) > 0
       AND abs(v_comm_sum - v_base) > 0.02 THEN
      RAISE EXCEPTION 'commission total does not match the first payment';
    END IF;

    INSERT INTO deal_closing_finance (account_id, sheet_id, payload)
    VALUES (v_deal.account_id, v_sheet_id, p_finance);
  END IF;

  -- A ficha ja existe, entao a trava deixa passar. Se o negocio ja era
  -- ganho (assinatura do contrato), so limpa a pendencia.
  UPDATE deals
  SET status = 'won',
      closing_pending = false,
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

REVOKE ALL ON FUNCTION close_deal_with_sheet(uuid, uuid, uuid, uuid, text, jsonb, text[], jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION close_deal_with_sheet(uuid, uuid, uuid, uuid, text, jsonb, text[], jsonb) TO authenticated;
