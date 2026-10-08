-- ============================================================
-- 107_timesheet_server_clock.sql — o relógio do banco manda no cronômetro
--
-- Problema
--   O início de um cronômetro é carimbado pelo banco (started_at DEFAULT now()),
--   mas o fim vinha do relógio de quem apertou "pausar" (servidor da aplicação)
--   e o número que corre na tela, do relógio do navegador. Com o relógio de um
--   computador adiantado em ~2 min, todo cronômetro nascia com ~2 min.
--
-- O que faz
--   1. server_now(): hora do banco, para a tela corrigir a diferença do relógio.
--   2. Trigger: ao PARAR um cronômetro (ended_at deixa de ser nulo) em um
--      lançamento não-manual, o fim passa a ser a hora do BANCO, qualquer que
--      seja o valor enviado. Lançamentos manuais e edições de períodos já
--      encerrados não são afetados.
--
-- NÃO altera dados existentes, tabelas, colunas nem permissões. Idempotente.
-- ============================================================

CREATE OR REPLACE FUNCTION public.server_now()
RETURNS timestamptz
LANGUAGE sql
STABLE
AS $$ SELECT now() $$;

GRANT EXECUTE ON FUNCTION public.server_now() TO authenticated;

CREATE OR REPLACE FUNCTION public.timesheet_stamp_end()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.ended_at IS NULL AND NEW.ended_at IS NOT NULL AND NOT NEW.is_manual THEN
    -- Sempre depois do início (a tabela exige ended_at > started_at).
    NEW.ended_at := GREATEST(clock_timestamp(), OLD.started_at + interval '1 millisecond');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS timesheet_stamp_end ON timesheet_entries;
CREATE TRIGGER timesheet_stamp_end
  BEFORE UPDATE ON timesheet_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.timesheet_stamp_end();
