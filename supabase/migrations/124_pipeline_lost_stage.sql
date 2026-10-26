-- ============================================================
-- 124_pipeline_lost_stage.sql — etapa fixa "Perdido" em todo pipeline
--
-- Igual ao "Contrato fechado" (054): toda pipeline tem exatamente UMA etapa
-- kind='lost', sempre logo antes de "Contrato fechado", que nao se renomeia,
-- move ou apaga. E o negocio perdido VAI para ela sozinho, em qualquer lugar
-- (pagina do negocio, Inbox, automacoes, API) — a regra mora no banco:
--
--   - status -> 'lost'                  : o cartao vai para a etapa Perdido
--                                         (guarda de onde veio em lost_from_stage_id);
--   - cartao entra na etapa Perdido     : status vira 'lost';
--   - status sai de 'lost' (reabrir)    : volta para a etapa de onde veio
--                                         (ou a primeira etapa, se ela sumiu);
--   - cartao sai da etapa Perdido       : o negocio volta a 'open' e o motivo some.
--   Negocio GANHO nao pode ir para Perdido (erro claro).
--
-- Backfill: promove a etapa "Perdido" que ja existe (Lead Generation, Prospeccao
-- com IA), cria a que falta (Desenvolvimento) e renumera as etapas deixando as
-- fixas por ultimo. Negocios perdidos fora da etapa vao para ela.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

-- ---- 1. schema ---------------------------------------------------------------
ALTER TABLE deals ADD COLUMN IF NOT EXISTS lost_from_stage_id uuid REFERENCES pipeline_stages(id) ON DELETE SET NULL;

ALTER TABLE pipeline_stages DROP CONSTRAINT IF EXISTS pipeline_stages_kind_check;
ALTER TABLE pipeline_stages
  ADD CONSTRAINT pipeline_stages_kind_check CHECK (kind IN ('custom', 'contract_closed', 'lost'));

CREATE UNIQUE INDEX IF NOT EXISTS uidx_pipeline_stages_lost
  ON pipeline_stages(pipeline_id) WHERE kind = 'lost';

-- ---- 2. backfill: one "Perdido" per pipeline ----------------------------------
-- 2a. promote an existing stage literally named "Perdido" (the first one)
UPDATE pipeline_stages ps
SET kind = 'lost'
WHERE ps.id IN (
  SELECT DISTINCT ON (pipeline_id) id
  FROM pipeline_stages
  WHERE lower(trim(name)) = 'perdido' AND kind = 'custom'
  ORDER BY pipeline_id, position, created_at
)
AND NOT EXISTS (
  SELECT 1 FROM pipeline_stages other WHERE other.pipeline_id = ps.pipeline_id AND other.kind = 'lost'
);

-- 2b. create it where it is missing
INSERT INTO pipeline_stages (pipeline_id, name, color, position, kind)
SELECT p.id, 'Perdido', '#ef4444', 0, 'lost'
FROM pipelines p
WHERE NOT EXISTS (SELECT 1 FROM pipeline_stages s WHERE s.pipeline_id = p.id AND s.kind = 'lost');

-- 2c. renumber: regular stages (in their order), then Perdido, then Contrato fechado
UPDATE pipeline_stages s
SET position = r.rn - 1
FROM (
  SELECT id,
         row_number() OVER (
           PARTITION BY pipeline_id
           ORDER BY (kind = 'contract_closed'), (kind = 'lost'), position, created_at, id
         ) AS rn
  FROM pipeline_stages
) r
WHERE r.id = s.id AND s.position <> r.rn - 1;

-- 2d. lost deals outside the stage go into it; deals already sitting in it are lost
UPDATE deals d
SET lost_from_stage_id = d.stage_id,
    stage_id = ls.id
FROM pipeline_stages ls
WHERE ls.pipeline_id = d.pipeline_id AND ls.kind = 'lost'
  AND d.status = 'lost' AND d.stage_id <> ls.id;

UPDATE deals d
SET status = 'lost'
FROM pipeline_stages ls
WHERE ls.pipeline_id = d.pipeline_id AND ls.kind = 'lost'
  AND d.stage_id = ls.id AND d.status = 'open';

-- ---- 3. the rule, in the database -----------------------------------------------
CREATE OR REPLACE FUNCTION deals_sync_lost_stage()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_lost uuid;
  v_back uuid;
BEGIN
  SELECT id INTO v_lost FROM pipeline_stages WHERE pipeline_id = NEW.pipeline_id AND kind = 'lost';
  IF v_lost IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'lost' AND NEW.stage_id <> v_lost THEN
      NEW.lost_from_stage_id := NEW.stage_id;
      NEW.stage_id := v_lost;
    ELSIF NEW.stage_id = v_lost AND NEW.status = 'open' THEN
      NEW.status := 'lost';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  IF NEW.status IS NOT DISTINCT FROM OLD.status AND NEW.stage_id IS NOT DISTINCT FROM OLD.stage_id THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'lost' AND OLD.status <> 'lost' THEN
    -- marked lost: the card goes to the Perdido stage
    IF NEW.stage_id <> v_lost THEN
      NEW.lost_from_stage_id := OLD.stage_id;
      NEW.stage_id := v_lost;
    ELSE
      NEW.lost_from_stage_id := COALESCE(NEW.lost_from_stage_id, OLD.stage_id);
    END IF;

  ELSIF NEW.stage_id = v_lost AND OLD.stage_id <> v_lost THEN
    -- dragged into Perdido
    IF NEW.status = 'won' THEN
      RAISE EXCEPTION 'Um negócio ganho não pode ser movido para Perdido.' USING ERRCODE = 'check_violation';
    END IF;
    NEW.status := 'lost';
    NEW.lost_from_stage_id := OLD.stage_id;

  ELSIF OLD.status = 'lost' AND NEW.status <> 'lost' THEN
    -- reopened (status changed): leave the Perdido stage
    IF NEW.stage_id = v_lost THEN
      SELECT id INTO v_back FROM pipeline_stages
        WHERE id = OLD.lost_from_stage_id AND pipeline_id = NEW.pipeline_id AND kind = 'custom';
      IF v_back IS NULL THEN
        SELECT id INTO v_back FROM pipeline_stages
          WHERE pipeline_id = NEW.pipeline_id AND kind = 'custom' ORDER BY position LIMIT 1;
      END IF;
      NEW.stage_id := COALESCE(v_back, NEW.stage_id);
    END IF;
    NEW.lost_from_stage_id := NULL;
    NEW.lost_reason := NULL;
    NEW.lost_reason_note := NULL;

  ELSIF OLD.stage_id = v_lost AND NEW.stage_id <> v_lost AND NEW.status = 'lost' THEN
    -- dragged out of Perdido: the deal is open again
    NEW.status := 'open';
    NEW.lost_from_stage_id := NULL;
    NEW.lost_reason := NULL;
    NEW.lost_reason_note := NULL;
  END IF;

  RETURN NEW;
END;
$$;

-- "aa_" so it runs before the other BEFORE triggers (closed_at, closing sheet) and they see the final status.
DROP TRIGGER IF EXISTS aa_deals_sync_lost_stage ON deals;
CREATE TRIGGER aa_deals_sync_lost_stage
  BEFORE INSERT OR UPDATE OF status, stage_id ON deals
  FOR EACH ROW
  EXECUTE FUNCTION deals_sync_lost_stage();
