-- ============================================================
-- 087_fin_clients_recurring.sql — "recorrente até cancelar"
--
-- A projeção dos meses futuros ("o contrato segue ate o cliente
-- cancelar") so vale para clientes RECORRENTES. A linha Criacao mistura
-- contratos mensais (renovacoes de hospedagem) com trabalhos pontuais
-- (landing page, catalogo), e projetar um pontual repetiria um valor
-- unico ate dezembro.
--
--   - fin_clients.recurring: false por padrao, entao os clientes que ja
--     existem NAO mudam de numero. O dono marca os recorrentes na grade.
--   - Clientes criados pela ficha de fechamento (fin_clients.deal_id
--     preenchido, ver 085) nascem recorrentes: a ficha so lanca servicos
--     MENSAIS. Um trigger faz isso, sem precisar reescrever a RPC.
--
-- Idempotent — safe to run multiple times.
-- ============================================================

ALTER TABLE fin_clients ADD COLUMN IF NOT EXISTS recurring boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION fin_clients_default_recurring()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.deal_id IS NOT NULL THEN
    NEW.recurring := true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS fin_clients_default_recurring ON fin_clients;
CREATE TRIGGER fin_clients_default_recurring
  BEFORE INSERT ON fin_clients
  FOR EACH ROW
  EXECUTE FUNCTION fin_clients_default_recurring();
