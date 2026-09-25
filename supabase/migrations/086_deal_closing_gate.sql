-- ============================================================
-- 086_deal_closing_gate.sql — Trava: sem ficha nao vira ganho
--
-- Aplicar JUNTO do deploy do codigo da ficha de fechamento (depende da
-- 085). Depois desta migracao o banco recusa qualquer UPDATE que marque
-- um negocio como 'won' sem ficha, exceto a assinatura do contrato
-- (handle_contract_signed liga app.allow_win durante o seu UPDATE).
-- O codigo antigo, que marcava ganho direto, para de funcionar — por
-- isso esta parte e separada da 085.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

CREATE OR REPLACE FUNCTION require_closing_sheet_before_won()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'won'
     AND OLD.status IS DISTINCT FROM 'won'
     AND COALESCE(current_setting('app.allow_win', true), '') <> 'on'
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

