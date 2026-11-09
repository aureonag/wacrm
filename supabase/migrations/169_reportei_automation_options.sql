-- Reportei: automacao completa. Frequencias diaria e quinzenal alem de semanal e
-- mensal; periodo de analise relativo escolhido (NULL = o padrao da frequencia);
-- comparacao propria (NULL = segue o template; 'none' = sem comparacao); e um
-- titulo proprio para o relatorio gerado (aceita {cliente} e {periodo}).

ALTER TABLE reportei_automations DROP CONSTRAINT IF EXISTS reportei_automations_frequency_check;
ALTER TABLE reportei_automations
  ADD CONSTRAINT reportei_automations_frequency_check
  CHECK (frequency IN ('daily', 'weekly', 'biweekly', 'monthly'));

ALTER TABLE reportei_automations ADD COLUMN IF NOT EXISTS analysis_period text
  CHECK (analysis_period IS NULL OR analysis_period IN (
    'previous_month', 'previous_fortnight', 'previous_week_mon_sun', 'previous_week_sun_sat',
    'last_30d', 'last_15d', 'last_7d_incl_today', 'last_7d_until_yesterday'));
ALTER TABLE reportei_automations ADD COLUMN IF NOT EXISTS compare_period text
  CHECK (compare_period IS NULL OR compare_period IN ('previous', 'none'));
ALTER TABLE reportei_automations ADD COLUMN IF NOT EXISTS report_title text
  CHECK (report_title IS NULL OR char_length(report_title) <= 200);
