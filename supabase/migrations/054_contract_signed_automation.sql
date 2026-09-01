-- ============================================================
-- 054_contract_signed_automation.sql
--
-- Two things, both about what happens when a contract gets signed:
--
--   1. Every pipeline gets a locked "Contrato fechado" stage, always
--      last, that the user cannot rename/reorder/delete from the
--      Pipeline settings UI (enforced in the frontend — see
--      pipeline-settings.tsx and pipelines/page.tsx — this migration
--      only adds the `kind` column + backfills the stage itself).
--
--   2. A trigger on `deal_contracts` that fires the moment a contract's
--      status flips to 'signed' — regardless of which signing method
--      got it there (the Clicksign webhook and the virtual-acceptance
--      `accept_contract` RPC both just do a plain UPDATE ... SET
--      status='signed', so this one trigger covers both without any
--      duplicated logic in either code path):
--        - moves the deal to that pipeline's "Contrato fechado" stage
--        - marks the deal `status='won'` (confirmed in the app code
--          that a 'won' deal is never hidden/filtered on the Kanban
--          board — it just gets a green badge, so the card stays
--          visible in its new column)
--        - logs a `deal_activities` row (free-text `type`, no CHECK
--          constraint on that column, so no migration needed there)
--        - inserts a `notifications` row for the deal's owner
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ---- 1. pipeline_stages.kind -------------------------------------------
ALTER TABLE pipeline_stages ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'custom';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pipeline_stages_kind_check'
  ) THEN
    ALTER TABLE pipeline_stages
      ADD CONSTRAINT pipeline_stages_kind_check CHECK (kind IN ('custom', 'contract_closed'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uidx_pipeline_stages_contract_closed
  ON pipeline_stages(pipeline_id) WHERE kind = 'contract_closed';

-- Backfill, in two passes:
--   1. A pipeline that already has a stage literally named "Contrato
--      fechado" (a user may have created one by hand before this
--      migration existed) gets THAT stage promoted to kind='contract_closed'
--      instead of a duplicate — preserves its id and any deals already
--      sitting in it.
--   2. Every remaining pipeline with no contract_closed stage at all gets
--      one appended after its current last stage.
UPDATE pipeline_stages ps
SET kind = 'contract_closed'
WHERE ps.name = 'Contrato fechado'
  AND ps.kind <> 'contract_closed'
  AND NOT EXISTS (
    SELECT 1 FROM pipeline_stages other
    WHERE other.pipeline_id = ps.pipeline_id AND other.kind = 'contract_closed'
  )
  -- If a pipeline somehow has more than one stage named "Contrato
  -- fechado", promote only the first by id so the unique partial index
  -- above doesn't reject the batch.
  AND ps.id = (
    SELECT MIN(dup.id) FROM pipeline_stages dup
    WHERE dup.pipeline_id = ps.pipeline_id AND dup.name = 'Contrato fechado'
  );

INSERT INTO pipeline_stages (pipeline_id, name, position, color, kind)
SELECT p.id,
       'Contrato fechado',
       COALESCE((SELECT MAX(ps.position) + 1 FROM pipeline_stages ps WHERE ps.pipeline_id = p.id), 0),
       '#22c55e',
       'contract_closed'
FROM pipelines p
WHERE NOT EXISTS (
  SELECT 1 FROM pipeline_stages ps WHERE ps.pipeline_id = p.id AND ps.kind = 'contract_closed'
);

-- ---- 2. notifications: new type + FKs -----------------------------------
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS deal_id uuid REFERENCES deals(id) ON DELETE CASCADE;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS contract_id uuid REFERENCES deal_contracts(id) ON DELETE CASCADE;

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('conversation_assigned', 'contract_signed'));

-- ---- 3. handle_contract_signed() trigger --------------------------------
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
  v_actor_name text;
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
    UPDATE deals SET status = 'won', stage_id = v_stage_id WHERE id = v_deal.id;

    INSERT INTO deal_activities (deal_id, account_id, user_id, type, title, detail)
    VALUES (
      v_deal.id,
      v_deal.account_id,
      NULL,
      'contract_signed',
      'Contrato assinado',
      'Negócio movido automaticamente para "Contrato fechado" e marcado como Ganho.'
    );
  END IF;

  -- Notify the deal's owner: prefer the assigned profile's user_id,
  -- fall back to the deal creator.
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
      'O contrato de "' || v_deal.title || '" foi assinado.'
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

DROP TRIGGER IF EXISTS on_contract_signed ON deal_contracts;
CREATE TRIGGER on_contract_signed
  AFTER UPDATE OF status ON deal_contracts
  FOR EACH ROW EXECUTE FUNCTION public.handle_contract_signed();
