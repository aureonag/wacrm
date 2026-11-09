-- Reportei: nome proprio da automacao (o passo 3 do assistente, como no Reportei).
ALTER TABLE reportei_automations ADD COLUMN IF NOT EXISTS name text
  CHECK (name IS NULL OR char_length(name) <= 120);
