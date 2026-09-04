-- 070_handoff_kickoff.sql -- ETAPA 3 (fase 3): handoff Comercial ->
-- Operacional e kickoff automatico ao fechar um negocio.
--
-- Design notes
--   - Nao existe hoje nenhum trigger generico "negocio ganho". O unico
--     caminho que cria automacao e handle_contract_signed() (054), que
--     dispara quando deal_contracts.status vira 'signed' -- esse fluxo
--     tambem deixa deals.status='won'. O botao manual "Marcar como
--     ganho" so faz um UPDATE direto sem trigger nenhum alem do
--     set_deal_closed_at() (que so carimba closed_at). Este trigger novo
--     (handle_deal_won, AFTER UPDATE OF status) cobre os DOIS caminhos de
--     uma vez so, sem duplicar logica -- mesmo espirito de
--     handle_contract_signed().
--   - deals.handoff_sector_id/handoff_assignee_id sao capturados no
--     momento do fechamento manual (dialog no app) -- quando ausentes
--     (ex.: fechamento automatico via assinatura de contrato), o kickoff
--     cai nos defaults da conta.
--   - operational_handoff_defaults e uma linha por conta (board/etapa
--     inicial/setor/responsavel padrao, template de titulo, prazo em
--     dias) -- se a conta nao configurou nada ainda, create_kickoff_task_for_deal
--     so avisa (RAISE WARNING) e nao cria a tarefa, nunca bloqueia o
--     fechamento do negocio.
--   - tasks.deal_id fecha o rastreamento inverso (permite ao futuro
--     Dashboard responder "um cliente fechado ja iniciou a operacao?").
--
-- Idempotent -- safe to run multiple times.

-- ---- deals: campos de handoff -----------------------------------------
ALTER TABLE deals ADD COLUMN IF NOT EXISTS handoff_sector_id uuid REFERENCES sectors(id) ON DELETE SET NULL;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS handoff_assignee_id uuid REFERENCES profiles(id) ON DELETE SET NULL;

-- ---- tasks: rastreamento inverso ----------------------------------------
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS deal_id uuid REFERENCES deals(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_deal ON tasks(deal_id);

-- ---- operational_handoff_defaults (uma linha por conta) -----------------
CREATE TABLE IF NOT EXISTS operational_handoff_defaults (
  account_id         uuid PRIMARY KEY REFERENCES accounts(id),
  board_id           uuid REFERENCES boards(id) ON DELETE SET NULL,
  initial_stage_id   uuid REFERENCES board_stages(id) ON DELETE SET NULL,
  default_sector_id  uuid REFERENCES sectors(id) ON DELETE SET NULL,
  default_assignee_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  title_template     text NOT NULL DEFAULT 'Kickoff - {deal}',
  due_offset_days    int,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE operational_handoff_defaults ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS operational_handoff_defaults_select ON operational_handoff_defaults;
CREATE POLICY operational_handoff_defaults_select ON operational_handoff_defaults FOR SELECT
  USING (is_account_member(account_id));
DROP POLICY IF EXISTS operational_handoff_defaults_upsert ON operational_handoff_defaults;
CREATE POLICY operational_handoff_defaults_upsert ON operational_handoff_defaults FOR INSERT
  WITH CHECK (is_account_member(account_id) AND has_permission('operational', 'tasks', 'edit_boards'));
DROP POLICY IF EXISTS operational_handoff_defaults_update ON operational_handoff_defaults;
CREATE POLICY operational_handoff_defaults_update ON operational_handoff_defaults FOR UPDATE
  USING (is_account_member(account_id) AND has_permission('operational', 'tasks', 'edit_boards'));

DROP TRIGGER IF EXISTS set_updated_at ON operational_handoff_defaults;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON operational_handoff_defaults
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---- create_kickoff_task_for_deal() --------------------------------------
CREATE OR REPLACE FUNCTION create_kickoff_task_for_deal(p_deal_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_deal deals%ROWTYPE;
  v_defaults operational_handoff_defaults%ROWTYPE;
  v_sector_id uuid;
  v_assignee_id uuid;
  v_title text;
  v_briefing jsonb;
  v_due_date date;
  v_new_task_id uuid;
  v_notify_user_id uuid;
BEGIN
  SELECT * INTO v_deal FROM deals WHERE id = p_deal_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT * INTO v_defaults FROM operational_handoff_defaults WHERE account_id = v_deal.account_id;
  IF NOT FOUND OR v_defaults.board_id IS NULL OR v_defaults.initial_stage_id IS NULL THEN
    RAISE WARNING 'create_kickoff_task_for_deal: handoff nao configurado para a conta %, negocio % ficou sem tarefa de kickoff', v_deal.account_id, v_deal.id;
    RETURN;
  END IF;

  v_sector_id := COALESCE(v_deal.handoff_sector_id, v_defaults.default_sector_id);
  v_assignee_id := COALESCE(v_deal.handoff_assignee_id, v_defaults.default_assignee_id);
  v_title := REPLACE(COALESCE(v_defaults.title_template, 'Kickoff - {deal}'), '{deal}', v_deal.title);
  v_due_date := CASE WHEN v_defaults.due_offset_days IS NOT NULL THEN (CURRENT_DATE + v_defaults.due_offset_days) ELSE NULL END;

  v_briefing := jsonb_build_object(
    'type', 'doc',
    'content', jsonb_build_array(
      jsonb_build_object('type', 'paragraph', 'content', jsonb_build_array(
        jsonb_build_object('type', 'text', 'text', format(
          'Negocio: %s | Valor: %s | Segmento: %s | Regiao: %s | Origem: %s',
          v_deal.title,
          COALESCE(v_deal.value::text, '-'),
          COALESCE(v_deal.segment, '-'),
          COALESCE(v_deal.region, '-'),
          COALESCE(v_deal.origin, '-')
        ))
      ))
    )
  );

  INSERT INTO tasks (
    account_id, board_id, stage_id, title, contact_id, sector_id, assignee_id,
    briefing, due_date, deal_id
  ) VALUES (
    v_deal.account_id, v_defaults.board_id, v_defaults.initial_stage_id, v_title, v_deal.contact_id,
    v_sector_id, v_assignee_id, v_briefing, v_due_date, v_deal.id
  )
  RETURNING id INTO v_new_task_id;

  IF v_assignee_id IS NOT NULL THEN
    SELECT user_id INTO v_notify_user_id FROM profiles WHERE id = v_assignee_id;
    PERFORM emit_task_notification(v_new_task_id, v_notify_user_id, 'kickoff_task_created', 'Tarefa de kickoff criada', v_title);
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'create_kickoff_task_for_deal falhou para o negocio %: %', p_deal_id, SQLERRM;
END;
$$;

-- ---- handle_deal_won() trigger --------------------------------------------
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

  PERFORM create_kickoff_task_for_deal(NEW.id);
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'handle_deal_won falhou para o negocio %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_deal_won ON deals;
CREATE TRIGGER on_deal_won
  AFTER UPDATE OF status ON deals
  FOR EACH ROW
  EXECUTE FUNCTION handle_deal_won();
