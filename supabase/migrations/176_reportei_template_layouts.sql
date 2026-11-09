-- Reportei: templates de relatorio como layout (quais redes e quais indicadores, sem
-- numero nenhum). Os templates dos especialistas (kind = 'expert', com a pessoa da
-- equipe em owner_profile_id) e "Meus templates" (kind = 'mine') ficam aqui; os
-- quatro do Reportei vem prontos no codigo. Linhas antigas (so metricas) continuam
-- valendo, com layout NULL.

ALTER TABLE reportei_templates ADD COLUMN IF NOT EXISTS description text CHECK (description IS NULL OR char_length(description) <= 500);
ALTER TABLE reportei_templates ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'mine' CHECK (kind IN ('mine', 'expert'));
ALTER TABLE reportei_templates ADD COLUMN IF NOT EXISTS owner_profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE reportei_templates ADD COLUMN IF NOT EXISTS layout jsonb;
